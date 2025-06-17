import React, { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";

/**
 * A highly customizable and accessible tab component
 * @param {Array} tabs - Array of tab objects: { label: string, component: ReactNode, disabled?: boolean }
 * @param {number} defaultIndex - Default active tab index
 * @param {string} tabClass - Additional class for tab buttons
 * @param {string} activeTabClass - Additional class for active tab
 * @param {string} disabledTabClass - Additional class for disabled tabs
 * @param {string} contentClass - Additional class for tab content
 * @param {boolean} vertical - Display tabs vertically
 * @param {function} onChange - Callback when tab changes
 */
const Tabs = ({ 
  tabs, 
  defaultIndex = 0,
  tabClass = "",
  activeTabClass = "",
  disabledTabClass = "",
  contentClass = "",
  vertical = false,
  onChange = () => {}
}) => {
  const [activeIndex, setActiveIndex] = useState(defaultIndex);
  const tabRefs = useRef([]);

  // Handle keyboard navigation
  const handleKeyDown = (e, index) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setActiveIndex(index);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = (index + 1) % tabs.length;
      if (!tabs[nextIndex].disabled) {
        setActiveIndex(nextIndex);
        tabRefs.current[nextIndex]?.focus();
      }
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = (index - 1 + tabs.length) % tabs.length;
      if (!tabs[prevIndex].disabled) {
        setActiveIndex(prevIndex);
        tabRefs.current[prevIndex]?.focus();
      }
    } else if (e.key === 'Home') {
      e.preventDefault();
      const firstEnabled = tabs.findIndex(tab => !tab.disabled);
      if (firstEnabled !== -1) {
        setActiveIndex(firstEnabled);
        tabRefs.current[firstEnabled]?.focus();
      }
    } else if (e.key === 'End') {
      e.preventDefault();
      const lastEnabled = [...tabs].reverse().findIndex(tab => !tab.disabled);
      if (lastEnabled !== -1) {
        const index = tabs.length - 1 - lastEnabled;
        setActiveIndex(index);
        tabRefs.current[index]?.focus();
      }
    }
  };

  // Call onChange callback when activeIndex changes
  useEffect(() => {
    onChange(activeIndex);
  }, [activeIndex, onChange]);

  // Scroll active tab into view if needed
  useEffect(() => {
    tabRefs.current[activeIndex]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center'
    });
  }, [activeIndex]);

  return (
    <div className={`flex ${vertical ? 'flex-row items-start' : 'flex-col'}`}>
      {/* Tab Headers */}
      <div 
        role="tablist"
        aria-orientation={vertical ? "vertical" : "horizontal"}
        className={`flex ${vertical ? 'flex-col w-48 border-r' : 'flex-row border-b'} border-gray-200`}
      >
        {tabs.map((tab, index) => (
          <button
            key={index}
            ref={el => tabRefs.current[index] = el}
            role="tab"
            id={`tab-${index}`}
            aria-selected={index === activeIndex}
            aria-controls={`tabpanel-${index}`}
            disabled={tab.disabled}
            onClick={() => setActiveIndex(index)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={`
              px-4 py-3 text-sm font-medium transition-colors duration-200
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
              ${index === activeIndex 
                ? `text-blue-600 ${vertical ? 'border-r-2' : 'border-b-2'} border-blue-600 ${activeTabClass}`
                : `text-gray-600 hover:text-blue-500 ${tab.disabled ? 'opacity-50 cursor-not-allowed ' + disabledTabClass : ''}`
              }
              ${tabClass}
            `}
            tabIndex={index === activeIndex ? 0 : -1}
          >
            {tab.label}
            {tab.badge && (
              <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-800">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div 
        id={`tabpanel-${activeIndex}`}
        role="tabpanel"
        aria-labelledby={`tab-${activeIndex}`}
        className={`flex-1 ${vertical ? 'pl-6' : 'pt-4'} ${contentClass}`}
      >
        {tabs[activeIndex]?.component}
      </div>
    </div>
  );
};

Tabs.propTypes = {
  tabs: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string.isRequired,
      component: PropTypes.node.isRequired,
      disabled: PropTypes.bool,
      badge: PropTypes.oneOfType([PropTypes.string, PropTypes.number])
    })
  ).isRequired,
  defaultIndex: PropTypes.number,
  tabClass: PropTypes.string,
  activeTabClass: PropTypes.string,
  disabledTabClass: PropTypes.string,
  contentClass: PropTypes.string,
  vertical: PropTypes.bool,
  onChange: PropTypes.func
};

export default Tabs;