import type { Locator, Page, Response } from "patchright";
import { z } from "zod";

import type { Credentials } from "./credentials.ts";
import { ORIGIN } from "./session.ts";

export class SignInError extends Error {
  override name = "SignInError";
}

const SignInFailureSchema = z.object({ error: z.object({ message: z.string() }) });

export interface SignInState {
  opened?: boolean;
  emailSubmitted?: boolean;
  passwordAttempted?: boolean;
  passwordSubmitted?: boolean;
  verificationRequired?: boolean;
}

const clickControl = async (page: Page, control: Locator): Promise<void> => {
  // Compose exposes semantics in a transparent shadow tree with pointer-events:none.
  // Click its current bounds to deliver the event to the canvas beneath it.
  const box = await control.boundingBox();

  if (!box || box.width <= 0 || box.height <= 0) {
    throw new Error("The sign-in control is unavailable");
  }

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};

const enterText = async (page: Page, field: Locator, value: string): Promise<void> => {
  await clickControl(page, field);
  await page.keyboard.press("ControlOrMeta+A");

  if (new URL(page.url()).origin !== ORIGIN) {
    throw new Error("The sign-in page left Beyond Budget");
  }

  await page.keyboard.insertText(value);
};

const waitForSignInRequest = async (page: Page) => {
  try {
    return await page.waitForRequest(
      (request) => {
        const url = new URL(request.url());

        return (
          request.method() === "POST" &&
          url.hostname === "identitytoolkit.googleapis.com" &&
          url.pathname.endsWith("/accounts:signInWithPassword")
        );
      },
      { timeout: 3000 }
    );
  } catch {
    return null;
  }
};

const signInFailure = async (response: Response): Promise<SignInError> => {
  let code = "";

  try {
    const failure = SignInFailureSchema.safeParse(await response.json());
    code = failure.success ? (failure.data.error.message.split(/[ :]/u)[0] ?? "") : "";
  } catch {
    // An intermediary can reject a request without returning Firebase's JSON error.
  }

  switch (code) {
    case "INVALID_LOGIN_CREDENTIALS":
    case "INVALID_PASSWORD":
    case "EMAIL_NOT_FOUND": {
      return new SignInError(
        "Beyond Budget rejected the email or password. Check BEBU_USERNAME and BEBU_PASSWORD"
      );
    }

    case "USER_DISABLED": {
      return new SignInError("Beyond Budget reports that this account is disabled");
    }

    case "TOO_MANY_ATTEMPTS_TRY_LATER":
    case "TOO_MANY_REQUESTS": {
      return new SignInError(
        "Beyond Budget temporarily blocked sign-in attempts. Wait before trying again"
      );
    }

    case "CAPTCHA_CHECK_FAILED":
    case "INVALID_APP_CREDENTIAL":
    case "INVALID_RECAPTCHA_TOKEN":
    case "MISSING_RECAPTCHA_TOKEN": {
      return new SignInError(
        "Beyond Budget rejected browser verification. Complete sign-in manually in the browser"
      );
    }

    default: {
      return new SignInError(
        `Beyond Budget rejected the sign-in request (HTTP ${response.status()})`
      );
    }
  }
};

const submitPassword = async (
  page: Page,
  password: Locator,
  credentials: Credentials,
  state: SignInState,
  progress?: (message: string) => void
): Promise<void> => {
  await enterText(page, password, credentials.password);
  const nativeSubmit = page.locator('[id="emailSignIn.submit"]');

  const submit =
    (await nativeSubmit.count()) > 0
      ? nativeSubmit
      : page.getByRole("button", { name: /^(?:sign in|log in)$/iu }).first();

  const pendingRequest = waitForSignInRequest(page);
  state.passwordAttempted = true;
  await clickControl(page, submit);
  const request = await pendingRequest;

  if (!request) {
    if (!page.isClosed()) {
      progress?.(
        "Password filled, but no sign-in request was sent. Use Sign in in the browser to continue."
      );
    }

    return;
  }

  progress?.("Sign-in request sent. Waiting for Beyond Budget...");
  const response = await request.response();

  if (!response) {
    throw new SignInError(
      "The sign-in response was interrupted. Check the browser before trying again"
    );
  }

  if (!response.ok()) {
    throw await signInFailure(response);
  }

  state.passwordSubmitted = true;
  progress?.("Sign-in request accepted. Waiting for session and budget access...");
};

export const advanceSignIn = async (
  page: Page,
  credentials: Credentials,
  state: SignInState,
  progress?: (message: string) => void
): Promise<void> => {
  if (new URL(page.url()).origin !== ORIGIN) {
    return;
  }

  if ((await page.locator("#attestationTryAgain").count()) > 0) {
    if (state.verificationRequired !== true) {
      progress?.(
        "Beyond Budget could not verify this browser. Use Try again in the browser to continue."
      );
    }

    state.verificationRequired = true;

    return;
  }

  if (state.passwordAttempted === true || state.passwordSubmitted === true) {
    return;
  }

  const email = page.getByRole("textbox", { exact: true, name: "Email" });

  const password = page
    .getByRole("textbox", { name: /password/iu })
    .or(page.locator('input[type="password"]'))
    .first();

  const welcome = page.getByRole("button", { exact: true, name: "Continue with email" });

  if (state.opened !== true && (await welcome.count()) > 0) {
    await clickControl(page, welcome);
    state.opened = true;
    progress?.("Opening email sign-in...");

    return;
  }

  if (state.emailSubmitted !== true && (await email.count()) > 0) {
    await enterText(page, email, credentials.username);
    await clickControl(page, page.getByRole("button", { exact: true, name: "Continue" }));
    state.emailSubmitted = true;
    progress?.("Email submitted. Waiting for the password screen...");

    return;
  }

  if (state.emailSubmitted === true && (await password.count()) > 0) {
    await submitPassword(page, password, credentials, state, progress);
  }
};
