/**
 * Application Configuration
 * Centralized configuration values for the application
 */

export const appConfig = {
  /**
   * Polling interval for pending analysis results (in milliseconds)
   * Used to refresh log and status for results with 'pending' status
   */
  RESULT_LOG_POLL_INTERVAL_MS: 5000,
  
  /**
   * Duration for toast notifications (in milliseconds)
   * How long toast messages stay visible before auto-dismiss
   */
  TOAST_DURATION_MS: 4000,
};
