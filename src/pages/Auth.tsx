import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

import { useAuth } from "@/hooks/use-auth";
import { LubaWordmark } from "@/components/luba";
import { api } from "@/convex/_generated/api";
import {
  ArrowLeft,
  ArrowRight,
  Gavel,
  Loader2,
  Mail,
  Send,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { useNavigate, useSearchParams } from "react-router";

type Provider = "email-otp" | "telegram-otp" | "sms-otp";
type Step = "method" | "identifier" | "verify";

interface AuthProps {
  redirectAfterAuth?: string;
}

const PROVIDER_LABEL: Record<Provider, string> = {
  "email-otp": "email",
  "telegram-otp": "Telegram",
  "sms-otp": "SMS",
};

function resolveRedirectAfterAuth(
  returnTo: string | null,
  fallback = "/dashboard",
) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );
  const authMethods = useQuery(api.authConfig.getAuthMethods);

  const [step, setStep] = useState<Step>("method");
  const [provider, setProvider] = useState<Provider>("email-otp");
  const [identifier, setIdentifier] = useState("");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(redirect);
    }
  }, [authLoading, isAuthenticated, navigate, redirect]);

  const cleanError = (err: unknown, fallback: string) => {
    // Convex auth errors arrive as Error("Uncaught Error: {\"message\":\"...\"}")
    const msg = err instanceof Error ? err.message : "";
    try {
      const match = msg.match(/\{"message":"(.*?)"\}/);
      if (match) return match[1];
      if (msg && !msg.startsWith("Uncaught Error: {")) {
        return msg.replace("Uncaught Error: ", "");
      }
    } catch {
      /* fall through */
    }
    return fallback;
  };

  const selectMethod = (p: Provider) => {
    setProvider(p);
    setIdentifier("");
    setError(null);
    setStep("identifier");
  };

  const handleIdentifierSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      // All three providers are Email-type, so the framework expects the
      // identifier in the `email` param (it holds an address, chat ID, or
      // phone depending on the provider).
      await signIn(provider, { email: identifier });
      setOtp("");
      setStep("verify");
    } catch (err) {
      setError(
        cleanError(
          err,
          `Failed to send the code. Please check your details and try again.`,
        ),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      await signIn(provider, { email: identifier, code: otp });
      navigate(redirect);
    } catch (err) {
      setError(cleanError(err, "The verification code is incorrect or expired."));
      setOtp("");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      await signIn(provider, { email: identifier });
      setOtp("");
    } catch (err) {
      setError(cleanError(err, "Couldn't resend the code. Please try again."));
    } finally {
      setIsLoading(false);
    }
  };

  const backToMethod = () => {
    setStep("method");
    setIdentifier("");
    setError(null);
  };

  const telegramEnabled = authMethods?.telegramOtp === true;
  const smsEnabled = authMethods?.smsOtp === true;
  const anyMethodEnabled =
    !authMethods || authMethods.emailOtp || telegramEnabled || smsEnabled;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Subtle brand backdrop */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,oklch(0.62_0.11_195/0.10),transparent_70%)]"
      />

      <div className="flex items-center justify-between px-4 py-5 sm:px-6">
        <LubaWordmark />
        <Button variant="ghost" className="text-muted-foreground" asChild>
          <a href="/">← Back to auctions</a>
        </Button>
      </div>

      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md">
          <Card className="border-border/80 pb-0 shadow-layered-lg">
            {step === "method" && (
              <>
                <CardHeader className="text-center">
                  <div className="mb-2 flex justify-center">
                    <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Gavel className="size-6" />
                    </span>
                  </div>
                  <CardTitle className="text-xl">Sign in to Luba</CardTitle>
                  <CardDescription>
                    Choose how you'd like to receive your one-time sign-in
                    code. New here? That's the whole sign-up.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Button
                    variant="outline"
                    className="h-auto justify-start gap-3 py-3"
                    onClick={() => selectMethod("email-otp")}
                  >
                    <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Mail className="size-4" />
                    </span>
                    <span className="flex flex-col items-start">
                      <span>Continue with Email</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        A 6-digit code sent to your inbox
                      </span>
                    </span>
                    <ArrowRight className="ml-auto size-4 text-muted-foreground" />
                  </Button>

                  <Button
                    variant="outline"
                    className="h-auto justify-start gap-3 py-3"
                    onClick={() => selectMethod("telegram-otp")}
                    disabled={!telegramEnabled}
                  >
                    <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Send className="size-4" />
                    </span>
                    <span className="flex flex-col items-start">
                      <span>Continue with Telegram</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {telegramEnabled
                          ? "A 6-digit code sent as a Telegram message"
                          : "Unavailable — not configured"}
                      </span>
                    </span>
                    <ArrowRight className="ml-auto size-4 text-muted-foreground" />
                  </Button>

                  <Button
                    variant="outline"
                    className="h-auto justify-start gap-3 py-3"
                    onClick={() => selectMethod("sms-otp")}
                    disabled={!smsEnabled}
                  >
                    <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Smartphone className="size-4" />
                    </span>
                    <span className="flex flex-col items-start">
                      <span>Continue with SMS</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {smsEnabled
                          ? "A 6-digit code sent by text message"
                          : "Unavailable — not configured"}
                      </span>
                    </span>
                    <ArrowRight className="ml-auto size-4 text-muted-foreground" />
                  </Button>

                  {!anyMethodEnabled && (
                    <p className="mt-2 text-center text-sm text-red-500">
                      No sign-in methods are currently available.
                    </p>
                  )}

                  <ul className="mt-4 space-y-2 text-xs leading-5 text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
                      One-time codes only — there's no password to manage or
                      leak.
                    </li>
                    <li className="flex items-start gap-2">
                      <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
                      Every accepted bid is confirmed instantly and recorded on
                      an auditable ledger.
                    </li>
                    <li className="flex items-start gap-2">
                      <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
                      Bidding requires a verified account and acceptance of the
                      terms. 18+.
                    </li>
                  </ul>
                </CardContent>
              </>
            )}

            {step === "identifier" && (
              <>
                <CardHeader className="text-center">
                  <CardTitle>
                    Sign in with {PROVIDER_LABEL[provider]}
                  </CardTitle>
                  <CardDescription>
                    {provider === "email-otp" &&
                      "Enter your email and we'll send a one-time code."}
                    {provider === "telegram-otp" &&
                      "Enter your numeric Telegram ID and we'll send a code to your Telegram."}
                    {provider === "sms-otp" &&
                      "Enter your phone number and we'll send a code by text."}
                  </CardDescription>
                </CardHeader>
                <form onSubmit={handleIdentifierSubmit}>
                  <CardContent>
                    <div className="relative">
                      {provider === "email-otp" ? (
                        <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Smartphone className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      )}
                      <Input
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        placeholder={
                          provider === "email-otp"
                            ? "name@example.com"
                            : provider === "telegram-otp"
                              ? "e.g. 123456789"
                              : "e.g. 0911223344"
                        }
                        type={
                          provider === "email-otp" ? "email" : "tel"
                        }
                        className="pl-9"
                        disabled={isLoading}
                        required
                      />
                    </div>
                    {error && (
                      <p className="mt-2 text-sm text-red-500">{error}</p>
                    )}

                    {provider === "telegram-otp" && (
                      <p className="mt-3 text-xs leading-5 text-muted-foreground">
                        <span className="font-medium text-foreground">
                          How to get your Telegram ID:
                        </span>{" "}
                        Open our Telegram bot and press <em>Start</em> — it will
                        reply with your numeric ID. (Telegram doesn't allow
                        lookup by username or phone number, so the ID is the one
                        thing it needs.)
                      </p>
                    )}

                    <div className="mt-5 flex gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={backToMethod}
                        disabled={isLoading}
                      >
                        <ArrowLeft className="size-4" />
                        Back
                      </Button>
                      <Button
                        type="submit"
                        className="flex-1"
                        disabled={isLoading || identifier.trim().length === 0}
                      >
                        {isLoading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Sending code…
                          </>
                        ) : (
                          <>
                            Send code
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </form>
              </>
            )}

            {step === "verify" && (
              <>
                <CardHeader className="mt-4 text-center">
                  <CardTitle>
                    Check your {PROVIDER_LABEL[provider]}
                  </CardTitle>
                  <CardDescription>
                    We sent a 6-digit code to{" "}
                    <span className="font-medium text-foreground">
                      {identifier}
                    </span>
                  </CardDescription>
                </CardHeader>
                <form onSubmit={handleOtpSubmit}>
                  <CardContent className="pb-4">
                    <div className="flex justify-center">
                      <InputOTP
                        value={otp}
                        onChange={setOtp}
                        maxLength={6}
                        disabled={isLoading}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            otp.length === 6 &&
                            !isLoading
                          ) {
                            const form = (e.target as HTMLElement).closest(
                              "form",
                            );
                            if (form) {
                              form.requestSubmit();
                            }
                          }
                        }}
                      >
                        <InputOTPGroup>
                          {Array.from({ length: 6 }).map((_, index) => (
                            <InputOTPSlot key={index} index={index} />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                    </div>
                    {error && (
                      <p className="mt-2 text-sm text-red-500 text-center">
                        {error}
                      </p>
                    )}
                    <p className="mt-4 text-center text-sm text-muted-foreground">
                      Didn't receive a code?{" "}
                      <Button
                        variant="link"
                        className="h-auto p-0"
                        onClick={handleResend}
                        type="button"
                      >
                        Send a new one
                      </Button>{" "}
                      or{" "}
                      <Button
                        variant="link"
                        className="h-auto p-0"
                        onClick={backToMethod}
                        type="button"
                      >
                        use another method
                      </Button>
                    </p>
                  </CardContent>
                  <CardFooter className="flex-col gap-2">
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={isLoading || otp.length !== 6}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Verifying…
                        </>
                      ) : (
                        <>
                          Verify code
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </CardFooter>
                </form>
              </>
            )}

            <div className="rounded-b-lg border-t bg-muted px-6 py-4 text-center text-xs text-muted-foreground">
              Secured by one-time codes. By continuing you accept Luba's Terms
              &amp; Conditions and confirm you are 18 or older.
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
