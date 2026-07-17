import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./styles.css"

function App() {
  return <main>Asset Box</main>
}

const root = document.getElementById("root")

if (!root) {
  throw new Error("Application root element is missing")
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
