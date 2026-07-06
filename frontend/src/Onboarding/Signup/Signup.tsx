

import { useState } from "react";
import { useNavigate } from "react-router-dom";

import styles from "./Signup.module.css";

//google oauth
import { useGoogleLogin } from "@react-oauth/google";




export default function SignupPage() {

  const navigate = useNavigate();
  


  type LawyerForm = {
    first_name: string;
    last_name: string;
    email: string;
    password: string;
    confirm_password: string;
  };

  // FORM STATE
  const [form, setForm] = useState<LawyerForm>({
    first_name: "",
    last_name: "",
    email: "",
    password: "",
    confirm_password: ""
  });

  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

 

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

      navigate("/workspace")

      console.log(data);

    },

});

  const handleChange = (e: any) => {
    setForm({ ...form, [e.target.name]: e.target.value });

    if (error) setError("");
  };

  const validate = () => {
    const nameRegex = /^[A-Za-z]+$/;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!nameRegex.test(form.first_name.trim())) {
      return "First name must contain only letters.";
    }

    if (!nameRegex.test(form.last_name.trim())) {
      return "Last name must contain only letters.";
    }

    if (!emailRegex.test(form.email)) {
      return "Enter a valid email address.";
    }

    if (form.password.length < 6) {
      return "Password must be at least 6 characters.";
    }

    if (form.password !== form.confirm_password) {
      return "Passwords do not match.";
    }

    return "";
  };

  const handleSubmit = async () => {
    const err = validate();

    if (err) {
      setError(err);
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch(`/api/auth/lawyer-signup`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          first_name: form.first_name,
          last_name: form.last_name,
          email: form.email,
          password: form.password
        })
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Something went wrong.");
        setSubmitting(false);
        return;
      }

    //   router.push("/Lawyer-Dashboard");
    } catch (err) {
      setError("Server error. Try again.");
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className={styles.root}>
        {/* LEFT: Visual Showcase */}
        <div className={styles.visualColumn}>
          <div className={styles.meshGradient} />

          <div className={styles.visualContent}>
            <h1 className={styles.visualTitle}>
              Designed for <br />
              <span>the elite.</span>
            </h1>

            <p className={styles.visualDesc}>
              Join the exclusive network of legal professionals powering the
              future of law with AI-driven precision.
            </p>
          </div>
        </div>

        {/* RIGHT: Form */}
        <div className={styles.formColumn}>
          {/* Nav */}
          <div className={styles.topNav}>
            <a href="/" className={styles.logo}>
              <span className="material-symbols-outlined">shield</span>
              LEXPAL PRO
            </a>

            <a href="/" className={styles.backBtn}>
              Exit Console
            </a>
          </div>

          {/* Form Container */}
          <div className={styles.formContent}>
            <div className={styles.formHeader}>
              <h2 className={styles.heading}>Advocate Signup.</h2>

              <p className={styles.subheading}>
                Apply for workspace access.{" "}
                {/* <a href="/Lawyer-Login">Sign in</a> */}
              </p>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmit();
              }}
              noValidate
            >
              {/* Name Row */}
              <div className={styles.row}>
                <div className={styles.inputGroup}>
                  <input
                    className={styles.input}
                    name="first_name"
                    value={form.first_name}
                    onChange={handleChange}
                    placeholder=" "
                    suppressHydrationWarning
                  />

                  <label className={styles.label}>First Name</label>
                </div>

                <div className={styles.inputGroup}>
                  <input
                    className={styles.input}
                    name="last_name"
                    value={form.last_name}
                    onChange={handleChange}
                    placeholder=" "
                    suppressHydrationWarning
                  />

                  <label className={styles.label}>Last Name</label>
                </div>
              </div>

              {/* Email */}
              <div className={styles.inputGroup}>
                <input
                  className={styles.input}
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder=" "
                  suppressHydrationWarning
                />

                <label className={styles.label}>
                  Professional Email
                </label>
              </div>

              {/* Password */}
              <div className={styles.inputGroup}>
                <div className={styles.passwordWrapper}>
                  <input
                    className={styles.input}
                    name="password"
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={handleChange}
                    placeholder=" "
                    suppressHydrationWarning
                  />

                  <label className={styles.label}>
                    Create Password
                  </label>

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
              </div>

              {/* Confirm Password */}
              <div className={styles.inputGroup}>
                <div className={styles.passwordWrapper}>
                  <input
                    className={styles.input}
                    name="confirm_password"
                    type={showConfirm ? "text" : "password"}
                    value={form.confirm_password}
                    onChange={handleChange}
                    placeholder=" "
                    suppressHydrationWarning
                  />

                  <label className={styles.label}>
                    Confirm Password
                  </label>

                  <button
                    type="button"
                    className={styles.toggleBtn}
                    onClick={() => setShowConfirm(!showConfirm)}
                  >
                    <span className="material-symbols-outlined">
                      {showConfirm
                        ? "visibility"
                        : "visibility_off"}
                    </span>
                  </button>
                </div>
              </div>

              {/* Google Signup */}
              <button
                type="button"
                className={styles.googleBtn}
                onClick={() => googleLogin()}
              >
                <svg width="18" height="18" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" /><path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" /><path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" /><path fill="#1976D2" d="M43.611 20.083 43.595 20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" /></svg>

                Continue with Google
              </button>

              {/* Error */}
              {error && (
                <div
                  style={{
                    color: "#ff453a",
                    marginBottom: 20,
                    marginTop: 20,
                    textAlign: "center"
                  }}
                >
                  {error}
                </div>
              )}

              {/* Submit */}
              <div className={styles.actions}>
                <button
                  type="submit"
                  className={styles.signupBtn}
                  disabled={submitting}
                  suppressHydrationWarning
                >
                  {submitting
                    ? "Processing..."
                    : "Create Account"}
                </button>
              </div>

              {/* Footer Link */}
              <div
                style={{
                  marginTop: "32px",
                  textAlign: "center"
                }}
              >
                <a
                  href="/login"
                  style={{
                    color: "var(--c-text-sec)",
                    fontSize: "13px",
                    textDecoration: "none",
                    fontWeight: 500
                  }}
                >
                  Already have an account?{" "}
                  <span
                    style={{
                      color: "var(--c-text-main)",
                      fontWeight: 600
                    }}
                  >
                    Log in →
                  </span>
                </a>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* <Footer userType="lawyer" /> */}
    </>
  );
}