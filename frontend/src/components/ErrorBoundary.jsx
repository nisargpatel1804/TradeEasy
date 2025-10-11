import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI.
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Log the error details
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({
      error,
      errorInfo
    });
  }

  render() {
    if (this.state.hasError) {
      // Fallback UI
      return (
        <div className="p-6 bg-red-50 border border-red-200 rounded-lg">
          <h2 className="text-lg font-semibold text-red-800 mb-2">Something went wrong</h2>
          <p className="text-red-600 mb-4">
            There was an error rendering this component. Please try refreshing the page.
          </p>
          {import.meta.env.DEV && this.state.error && (
            <details className="text-sm">
              <summary className="cursor-pointer text-red-700 font-medium">Error details (dev mode)</summary>
              <pre className="mt-2 text-xs overflow-auto bg-red-100 p-2 rounded">
                {this.state.error.toString()}
                {this.state.errorInfo.componentStack}
              </pre>
            </details>
          )}
          <button
            onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;