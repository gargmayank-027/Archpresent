"use client";

import { useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function SignUpPage() {
  const { status } = useSession();
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
  }, [status, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) { setError("Name is required."); return; }
    if (!email.trim() || !email.includes("@")) { setError("Enter a valid email."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }

    setSubmitting(true);

    try {
      // 1. Register
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Registration failed.");

      // 2. Automatically sign in
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        throw new Error("Account created but sign-in failed. Please go to login.");
      }

      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="spinner w-5 h-5 text-stone-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm fade-up fade-up-1">

        {/* Brand */}
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-2 mb-6">
            <span className="font-mono text-[10px] tracking-[0.2em] text-stone-400 uppercase">Arch</span>
            <span className="w-px h-4 bg-stone-300" />
            <span className="font-display text-2xl font-light text-stone-700"
              style={{ fontFamily: "'Cormorant Garamond', serif" }}>Present</span>
          </div>
          <h1 className="font-display text-3xl font-light text-stone-900 mb-2"
              style={{ fontFamily: "'Cormorant Garamond', serif" }}>
            Create your account
          </h1>
          <p className="text-sm text-stone-500">
            Set up in 30 seconds. No credit card needed.
          </p>
        </div>

        {error && (
          <div className="alert alert-error mb-6 text-sm">{error}</div>
        )}

        {/* Sign-up form */}
        <div className="space-y-4 mb-6">
          <div>
            <label className="field-label">Full name</label>
            <input type="text" className="field-input" placeholder="e.g. Priya Sharma"
              value={name} onChange={(e) => setName(e.target.value)} autoFocus disabled={submitting} />
          </div>
          <div>
            <label className="field-label">Email</label>
            <input type="email" className="field-input" placeholder="you@studio.in"
              value={email} onChange={(e) => setEmail(e.target.value)} disabled={submitting} />
          </div>
          <div>
            <label className="field-label">Password</label>
            <input type="password" className="field-input" placeholder="At least 6 characters"
              value={password} onChange={(e) => setPassword(e.target.value)} disabled={submitting} />
          </div>
          <div>
            <label className="field-label">Confirm password</label>
            <input type="password" className="field-input" placeholder="Re-enter your password"
              value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={submitting}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit(e)} />
          </div>
        </div>

        <button type="button" onClick={handleSubmit} disabled={submitting}
          className="btn-primary w-full py-3 flex items-center justify-center gap-2">
          {submitting ? <><span className="spinner w-3 h-3" style={{ borderWidth: 1 }} /> Creating account…</> : "Create account"}
        </button>

        {/* Divider */}
        <div className="flex items-center gap-4 my-6">
          <div className="flex-1 h-px bg-stone-200" />
          <span className="font-mono text-[9px] text-stone-400 uppercase tracking-widest">or</span>
          <div className="flex-1 h-px bg-stone-200" />
        </div>

        {/* OAuth options */}
        <div className="space-y-2.5">
          <button type="button" onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-3 px-5 py-2.5 bg-white border border-stone-200 rounded-sm hover:border-stone-400 hover:shadow-md transition-all disabled:opacity-50">
            <svg width="16" height="16" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            <span className="font-mono text-[10px] uppercase tracking-widest text-stone-600">Google</span>
          </button>

          <button type="button" onClick={() => signIn("apple", { callbackUrl: "/dashboard" })}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-3 px-5 py-2.5 bg-stone-900 border border-stone-900 rounded-sm hover:bg-stone-800 transition-all disabled:opacity-50">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
            </svg>
            <span className="font-mono text-[10px] uppercase tracking-widest text-white">Apple</span>
          </button>
        </div>

        {/* Already have account */}
        <p className="text-center mt-8 text-sm text-stone-500">
          Already have an account?{" "}
          <a href="/login" className="text-stone-800 hover:text-stone-600 underline underline-offset-2 transition-colors">
            Sign in
          </a>
        </p>

        {/* Back */}
        <div className="text-center mt-4">
          <a href="/" className="font-mono text-[10px] text-stone-400 hover:text-stone-600 uppercase tracking-widest transition-colors">
            ← Back to home
          </a>
        </div>
      </div>
    </div>
  );
}
