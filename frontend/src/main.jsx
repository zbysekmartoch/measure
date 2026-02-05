/**
 * Application Entry Point
 * 
 * This is the main entry file for the React application.
 * It initializes AG Grid modules globally and renders the root App component.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// AG Grid styles - must be imported before components
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import './index.css'

// Register AG Grid community modules globally
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
ModuleRegistry.registerModules([AllCommunityModule]);

// Mount React application to DOM
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
