import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

//google auth
import { GoogleOAuthProvider } from "@react-oauth/google";

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID} >
    <App />
    </GoogleOAuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
