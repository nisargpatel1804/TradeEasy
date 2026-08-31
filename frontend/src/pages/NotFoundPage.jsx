import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/button.jsx';

/**
 * A user-friendly 404 "Not Found" page.
 * This component is displayed when a user navigates to a route that is not defined.
 */
const NotFoundPage = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-center p-4">
      <div className="max-w-md">
        <h1 className="text-8xl md:text-9xl font-bold text-gray-800 animate-pulse">
          404
        </h1>
        <h2 className="mt-4 text-2xl md:text-3xl font-semibold text-gray-700">
          Page Not Found
        </h2>
        <p className="mt-4 text-gray-500">
          Oops! The page you&apos;re looking for seems to have taken a day off.
          Let&apos;s get you back on track.
        </p>
        <div className="mt-8">
          <Link to="/dashboard">
            <Button className="font-semibold">
              Go to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default NotFoundPage;