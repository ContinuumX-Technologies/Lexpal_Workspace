

import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

import styles from "./Login.module.css";

//google oauth
import { useGoogleLogin } from "@react-oauth/google";


type FormState = {
  email: string;
  password: string;
};




export default function LoginPage() {
   
  const navigate = useNavigate();

  

  const [form, setForm] = useState<FormState>({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


  useEffect(() => {

    setMounted(true);

  }, []);






  //google auth function
  const googleLogin = useGoogleLogin({

    flow: "auth-code",

    onSuccess: async (codeResponse) => {

      console.log(codeResponse);

      const response = await fetch("/api/auth/google", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include", // backend sets the JWT as an HttpOnly cookie
        body: JSON.stringify({
          code: codeResponse.code,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Google authentication failed");
      }

      console.log(data);

      navigate("/workspace");

    },

  });






  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((s) => ({ ...s, [e.target.name]: e.target.value }));
    if (error) setError(null);
  };

  const validate = (): string | null => {
    if (!form.email.trim()) return "Email is required.";
    if (!emailRegex.test(form.email)) return "Enter a valid email address.";
    if (!form.password) return "Password is required.";
    if (form.password.length < 6)
      return "Password must be at least 6 characters.";
    return null;
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`/api/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email, password: form.password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Login failed. Try again.");
        setSubmitting(false);
        return;
      }

         navigate("/workspace");
    } catch (err) {
      console.error(err);
      setError("Server error, try again later.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!mounted) {
    return (
      <div className={styles.loadingScreen}>
        <div className={styles.loadingContent}>
          <div className={styles.loadingLogo}>
            <span className="material-symbols-outlined">balance</span>
          </div>
          <div className={styles.loadingSpinner} />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={styles.root}>



        {/* LEFT: Visual Showcase (Titanium Pro) */}
        <div className={styles.visualColumn}>
          <div className={styles.meshGradient} />

          <div className={styles.visualContent}>
            <h1 className={styles.visualTitle}>
              Authorized <br />
              <span>Personnel Only.</span>
            </h1>
            <p className={styles.visualDesc}>
              Lexpal Pro provides secure, AI-native legal reasearch and intelligence for the modern legal elite.
            </p>
          </div>
        </div>






        {/* RIGHT: Functional Form */}
        <div className={styles.formColumn}>
          {/* Nav */}
          <div className={styles.topNav}>
            <a href="/" className={styles.logo}>
              <span className="material-symbols-outlined">shield</span>
              LEXPAL
            </a>
            <a href="/" className={styles.backBtn}>Exit Console</a>
          </div>

          {/* Form Container */}
          <div className={styles.formContent}>
            <div className={styles.formHeader}>
              <h2 className={styles.heading}>Advocate Access</h2>
              <p className={styles.subheading}>
                new to Workspace? <a href="/signup">Request access → </a>
              </p>
            </div>

            <form onSubmit={handleSubmit} noValidate>
              <div className={styles.inputGroup}>
                <input
                  className={styles.input}
                  name="email"
                  type="email"
                  placeholder=" "
                  value={form.email}
                  onChange={handleChange}
                />
                <label className={styles.label}>Professional Email</label>
              </div>

              <div className={styles.inputGroup}>
                <input
                  className={styles.input}
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder=" "
                  value={form.password}
                  onChange={handleChange}
                />
                <label className={styles.label}>Secure Key</label>
                <button
                  type="button"
                  className={styles.toggleBtn}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  <span className="material-symbols-outlined">
                    {showPassword
                      ? "visibility"
                      : "visibility_off"}
                  </span>
                </button>
              </div>

              {error && <div style={{ color: '#ff453a', marginBottom: 16 }}>{error}</div>}

              <div className={styles.actions}>
                <button type="submit" className={styles.signInBtn} disabled={submitting}>
                  {submitting ? "Verifying..." : "Authenticate"}
                </button>

                <div className={styles.divider}>
                  <span>or authenticate with</span>
                </div>

                <button type="button" className={styles.googleBtn} suppressHydrationWarning onClick={() => googleLogin()}>
                  <svg width="18" height="18" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" /><path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" /><path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" /><path fill="#1976D2" d="M43.611 20.083 43.595 20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" /></svg>
                  Login using Google
                </button>
              </div>


            </form>


          </div>


        </div>





      </div>
      {/* <Footer userType="lawyer" /> */}
    </>
  );
}
