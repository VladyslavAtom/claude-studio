import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import '@xterm/xterm/css/xterm.css'

// no StrictMode: double-invoked effects would re-attach terminals and replay their scrollback
createRoot(document.getElementById('root') as HTMLElement).render(<App />)
