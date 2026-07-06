// App.tsx
import { Routes, Route } from 'react-router-dom'
// import Home from './routes/Home'
import Workspace from './Workspace/Workspace'
import SignupPage from './Onboarding/Signup/Signup'
import LoginPage from './Onboarding/Login/Login'

export default function App() {
  return (
    <Routes>
      {/* <Route path="/" element={<Home />} /> */}
      <Route path="/workspace" element={<Workspace />} />
      <Route path="/workspace/:caseId" element={<Workspace />} />
      <Route path="/signup" element={<SignupPage/>}/>
      <Route path="/login" element={<LoginPage/>} />
    </Routes>
  )
}