// App.tsx
import { Routes, Route } from 'react-router-dom'
// import Home from './routes/Home'
import Workspace from './Workspace/Workspace'

export default function App() {
  return (
    <Routes>
      {/* <Route path="/" element={<Home />} /> */}
      <Route path="/workspace" element={<Workspace />} />
    </Routes>
  )
}