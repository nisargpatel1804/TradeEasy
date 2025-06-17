import React from "react";
import PropTypes from "prop-types";
import { RotateCw } from "lucide-react";

/**
 * A customizable loading spinner component
 * @param {string} size - Size of the spinner (sm, md, lg)
 * @param {string} className - Additional className for styling
 * @param {string} color - Color of the spinner (default: primary-500)
 * @param {string} text - Optional text to display below spinner
 */
const LoadingSpinner = ({ 
  size = "md", 
  className = "",
  color = "text-primary-500",
  text = ""
}) => {
  const sizes = {
    sm: "h-4 w-4",
    md: "h-6 w-6",
    lg: "h-8 w-8"
  };

  return (
    <div className={`flex flex-col items-center justify-center gap-2 ${className}`}>
      <RotateCw 
        className={`${sizes[size]} ${color} animate-spin`} 
        aria-hidden="true"
      />
      {text && <p className="text-sm text-gray-500">{text}</p>}
      <span className="sr-only">Loading...</span>
    </div>
  );
};

LoadingSpinner.propTypes = {
  size: PropTypes.oneOf(["sm", "md", "lg"]),
  className: PropTypes.string,
  color: PropTypes.string,
  text: PropTypes.string
};

export default LoadingSpinner;