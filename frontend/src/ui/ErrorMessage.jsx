import React from "react";
import PropTypes from "prop-types";
import { AlertCircle } from "lucide-react";

/**
 * A customizable error message component with retry option
 * @param {string} message - Error message to display
 * @param {function} onRetry - Function to call when retry button is clicked
 * @param {string} className - Additional className for styling
 * @param {string} variant - Variant of error message (default: error)
 */
const ErrorMessage = ({ 
  message, 
  onRetry, 
  className = "",
  variant = "error"
}) => {
  const variants = {
    error: {
      bg: "bg-red-50",
      text: "text-red-600",
      button: "bg-red-600 hover:bg-red-700"
    },
    warning: {
      bg: "bg-yellow-50",
      text: "text-yellow-600",
      button: "bg-yellow-600 hover:bg-yellow-700"
    },
    info: {
      bg: "bg-blue-50",
      text: "text-blue-600",
      button: "bg-blue-600 hover:bg-blue-700"
    }
  };

  const currentVariant = variants[variant] || variants.error;

  return (
    <div className={`rounded-md p-4 ${currentVariant.bg} ${className}`}>
      <div className="flex items-center">
        <div className="flex-shrink-0">
          <AlertCircle className={`h-5 w-5 ${currentVariant.text}`} aria-hidden="true" />
        </div>
        <div className="ml-3 flex-1">
          <p className={`text-sm font-medium ${currentVariant.text}`}>
            {message}
          </p>
        </div>
        {onRetry && (
          <div className="ml-auto pl-3">
            <div className="-mx-1.5 -my-1.5">
              <button
                type="button"
                onClick={onRetry}
                className={`inline-flex rounded-md px-2 py-1 text-sm font-medium text-white ${currentVariant.button} focus:outline-none focus:ring-2 focus:ring-offset-2`}
              >
                Retry
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

ErrorMessage.propTypes = {
  message: PropTypes.string.isRequired,
  onRetry: PropTypes.func,
  className: PropTypes.string,
  variant: PropTypes.oneOf(["error", "warning", "info"])
};

export default ErrorMessage;