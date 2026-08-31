import React from 'react';
import { cn } from '../lib/cn.js';

const Sparkline = ({ data = [], width = 60, height = 24, className = "" }) => {
  // Show a faint loading pulse if data isn't ready
  if (!data || data.length < 2) {
    return <div style={{ width, height }} className={cn("bg-slate-100 rounded-md animate-pulse", className)} />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1; // Prevent division by zero if all prices are identical

  // Map prices to X,Y coordinates on the SVG canvas
  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    // Invert Y axis (SVG 0,0 is top-left)
    const y = height - ((val - min) / range) * height;
    return `${x},${y}`;
  });

  const isPositive = data[data.length - 1] >= data[0];
  const color = isPositive ? "#10b981" : "#ef4444"; // Tailwind emerald-500 : red-500

  return (
    <svg 
      width={width} 
      height={height} 
      className={className} 
      viewBox={`0 -2 ${width} ${height + 4}`} // Padding prevents stroke clipping
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points.join(" ")}
      />
    </svg>
  );
};

export default Sparkline;