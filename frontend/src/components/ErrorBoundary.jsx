import React from 'react';

/**
 * A React Error Boundary component.
 * It catches JavaScript errors in its child component tree, logs them,
 * and displays a fallback UI.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  /**
   * This lifecycle method is used to render a fallback UI after an error
   * has been thrown.
   * @param {Error} error The error that was thrown.
   * @returns {object} An object to update state.
   */
  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI.
    return { hasError: true };
  }

  /**
   * This lifecycle method is called after an error has been thrown by a
   * descendant component. It receives the error and information about
   * which component threw the error.
   * @param {Error} error The error that was thrown.
   * @param {object} errorInfo An object with a `componentStack` key.
   */
  componentDidCatch(error, errorInfo) {
    // You can also log the error to an error reporting service
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  render() {
    if (this.state.hasError) {
      // You can render any custom fallback UI
      return (
        <div className="p-6 bg-red-50 border border-red-200 rounded-lg text-center mx-auto my-10 max-w-2xl">
          <h2 className="text-xl font-semibold text-red-800 mb-2">Something Went Wrong</h2>
          <p className="text-red-700 mb-4">
            We&apos;ve encountered an unexpected error. Please try refreshing the page or clicking the button below.
          </p>
          
          {/* Only show detailed error info in development mode for security */}
          {import.meta.env.MODE !== 'production' && this.state.error && (
            <details className="text-sm bg-red-100 p-3 rounded-md mt-4 text-left">
              <summary className="cursor-pointer text-red-800 font-medium">
                Error Details (Development Mode)
              </summary>
              <pre className="mt-2 text-xs overflow-auto bg-white p-2 rounded shadow-inner text-red-900">
                {this.state.error.toString()}
                {this.state.errorInfo.componentStack}
              </pre>
            </details>
          )}

          <button
            onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
            className="mt-6 px-5 py-2 bg-red-600 text-white font-semibold rounded-lg shadow-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
          >
            Try Again
          </button>
        </div>
      );
    }

    // If there's no error, render children as normal.
    return this.props.children;
  }
}

export default ErrorBoundary;