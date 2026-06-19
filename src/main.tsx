import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import { PayPalScriptProvider } from '@paypal/react-paypal-js'
import './index.css'
import './i18n'
import App from './App.tsx'
import { CurrencyProvider } from './context/CurrencyContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PayPalScriptProvider options={{
      clientId: import.meta.env.VITE_PAYPAL_CLIENT_ID,
      currency: 'JPY',
      intent: 'capture',
    }}>
      <HashRouter>
        <CurrencyProvider>
          <App />
        </CurrencyProvider>
      </HashRouter>
    </PayPalScriptProvider>
  </StrictMode>,
)
