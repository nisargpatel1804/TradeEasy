import React, { useState, useEffect, useRef } from 'react';

/**
 * LazyList - Component that implements virtual scrolling/lazy loading for large lists
 * 
 * @param {Array} items - Full array of items to display
 * @param {function} renderItem - Function to render each item: (item, index) => ReactNode
 * @param {number} itemsPerPage - Number of items to load per page (default: 20)
 * @param {string} loadingText - Text to show while loading more (default: "Loading more...")
 */
export const LazyList = ({ 
  items = [], 
  renderItem, 
  itemsPerPage = 20,
  loadingText = "Loading more...",
  className = ""
}) => {
  const [displayedItems, setDisplayedItems] = useState([]);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const observerTarget = useRef(null);

  // Reset when items change
  useEffect(() => {
    setDisplayedItems(items.slice(0, itemsPerPage));
    setPage(1);
  }, [items, itemsPerPage]);

  // Load more items
  const loadMore = () => {
    if (isLoading || displayedItems.length >= items.length) {
      return;
    }

    setIsLoading(true);
    
    // Simulate async loading with setTimeout
    setTimeout(() => {
      const nextPage = page + 1;
      const startIndex = page * itemsPerPage;
      const endIndex = nextPage * itemsPerPage;
      const newItems = items.slice(0, endIndex);
      
      setDisplayedItems(newItems);
      setPage(nextPage);
      setIsLoading(false);
    }, 100);
  };

  // Intersection Observer to detect when user scrolls to bottom
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoading) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    const currentTarget = observerTarget.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [isLoading, displayedItems.length, items.length]);

  return (
    <div className={className}>
      {displayedItems.map((item, index) => (
        <div key={item.id || index}>
          {renderItem(item, index)}
        </div>
      ))}
      
      {displayedItems.length < items.length && (
        <div ref={observerTarget} className="py-4 text-center">
          {isLoading && (
            <p className="text-sm text-muted-foreground">{loadingText}</p>
          )}
        </div>
      )}
      
      {displayedItems.length >= items.length && items.length > 0 && (
        <div className="py-4 text-center">
          <p className="text-sm text-muted-foreground">
            All items loaded ({items.length})
          </p>
        </div>
      )}
    </div>
  );
};
