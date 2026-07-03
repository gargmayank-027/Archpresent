"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";

function LoginContent() {
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";
  const [signingIn, setSigningIn] = useState<string | null>(null);

  useEffect(() => {
    if (status === "authenticated") router.replace(callbackUrl);
  }, [status, router, callbackUrl]);

  async function handleSignIn(provider: string) {
    setSigningIn(provider);
    await signIn(provider, { callbackUrl });
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="spinner w-5 h-5 text-stone-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm fade-up fade-up-1">

        {/* Brand */}
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-2 mb-6">
            <span className="font-mono text-[11px] tracking-[0.2em] text-stone-400 uppercase">Arch</span>
            <span className="w-px h-4 bg-stone-300" />
            <span className="font-display text-2xl font-light text-stone-700"
              style={{ fontFamily: "'Cormorant Garamond', serif" }}>Present</span>
          </div>
          <h1 className="font-display text-3xl font-light text-stone-900 mb-2"
              style={{ fontFamily: "'Cormorant Garamond', serif" }}>
            Welcome
          </h1>
          <p className="text-sm text-stone-500">
            Sign in to create and manage your concept presentations.
          </p>
        </div>

        {/* Sign-in buttons */}
        <div className="space-y-3">

          {/* Google */}
          <button
            type="button"
            onClick={() => handleSignIn("google")}
            disabled={!!signingIn}
            className="w-full flex items-center justify-center gap-3 px-5 py-3 bg-white border border-stone-200 rounded-sm hover:border-stone-400 hover:shadow-md transition-all disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            <span className="font-mono text-[11px] uppercase tracking-widest text-stone-700">
              {signingIn === "google" ? "Redirecting…" : "Continue with Google"}
            </span>
          </button>

          {/* Apple */}
          <button
            type="button"
            onClick={() => handleSignIn("apple")}
            disabled={!!signingIn}
            className="w-full flex items-center justify-center gap-3 px-5 py-3 bg-stone-900 border border-stone-900 rounded-sm hover:bg-stone-800 transition-all disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
              <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
            </svg>
            <span className="font-mono text-[11px] uppercase tracking-widest text-white">
              {signingIn === "apple" ? "Redirecting…" : "Continue with Apple"}
            </span>
          </button>
        </div>

        {/* Terms */}
        <p className="text-center text-[10px] text-stone-400 mt-8 leading-relaxed">
          By signing in, you agree to our terms of service and privacy policy.
        </p>

        {/* Back to home */}
        <div className="text-center mt-6">
          <a href="/" className="font-mono text-[10px] text-stone-400 hover:text-stone-600 uppercase tracking-widest transition-colors">
            ← Back to home
          </a>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <span className="spinner w-5 h-5 text-stone-400" />
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
