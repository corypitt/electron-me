import React, { useState, useEffect } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';
import type { NextPage } from 'next';
import Layout from '../components/Layout';

const Settings: NextPage = () => {
  const { data: session, status } = useSession();
  const [gmailConnected, setGmailConnected] = useState(false);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session?.user) {
      checkConnectionStatus();
    }
  }, [session]);

  const checkConnectionStatus = async () => {
    try {
      setIsChecking(true);
      setError(null);
      const response = await fetch('/api/google/status');
      if (!response.ok) {
        throw new Error('Failed to check connection status');
      }
      const data = await response.json();
      setGmailConnected(data.gmailConnected);
      setCalendarConnected(data.calendarConnected);
    } catch (error) {
      console.error('Error checking connection status:', error);
      setError('Failed to check connection status. Please try again.');
    } finally {
      setIsChecking(false);
    }
  };

  const handleGoogleSignIn = () => {
    signIn('google', {
      callbackUrl: '/settings',
      scope: 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.readonly'
    });
  };

  const handleGoogleSignOut = async () => {
    try {
      setError(null);
      await signOut({ callbackUrl: '/settings' });
    } catch (error) {
      console.error('Error signing out:', error);
      setError('Failed to sign out. Please try again.');
    }
  };

  return (
    <Layout>
      <div className="bg-white shadow-md rounded-lg p-6">
        <h1 className="text-2xl font-bold mb-6">Settings</h1>
        
        <div className="space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md">
              {error}
            </div>
          )}

          <div className="border-b pb-6">
            <h2 className="text-xl font-semibold mb-4">Google Integration</h2>
            
            {status === 'loading' || isChecking ? (
              <div className="flex items-center space-x-2 text-gray-600">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-500 border-t-transparent"></div>
                <span>Loading...</span>
              </div>
            ) : session ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Connected as: {session.user?.email}</p>
                    <div className="mt-4 space-y-3">
                      <div className="flex items-center space-x-3">
                        <div className={`w-3 h-3 rounded-full ${gmailConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                        <span className="text-gray-700">Gmail {gmailConnected ? 'Connected' : 'Not Connected'}</span>
                        {!gmailConnected && (
                          <button
                            onClick={handleGoogleSignIn}
                            className="text-sm text-blue-500 hover:text-blue-600"
                          >
                            Connect
                          </button>
                        )}
                      </div>
                      <div className="flex items-center space-x-3">
                        <div className={`w-3 h-3 rounded-full ${calendarConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                        <span className="text-gray-700">Calendar {calendarConnected ? 'Connected' : 'Not Connected'}</span>
                        {!calendarConnected && (
                          <button
                            onClick={handleGoogleSignIn}
                            className="text-sm text-blue-500 hover:text-blue-600"
                          >
                            Connect
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col space-y-2">
                    <button
                      onClick={checkConnectionStatus}
                      className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
                    >
                      Refresh Status
                    </button>
                    <button
                      onClick={handleGoogleSignOut}
                      className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="text-gray-600">
                    <p className="mb-2">Connect your Google account to enable:</p>
                    <ul className="list-disc text-left ml-6">
                      <li>Email drafting with AI assistance</li>
                      <li>Calendar context in conversations</li>
                      <li>Smart scheduling suggestions</li>
                    </ul>
                  </div>
                  <button
                    onClick={handleGoogleSignIn}
                    className="px-6 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors flex items-center space-x-2"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path
                        fill="currentColor"
                        d="M21.35,11.1H12.18V13.83H18.69C18.36,17.64 15.19,19.27 12.19,19.27C8.36,19.27 5,16.25 5,12C5,7.9 8.2,4.73 12.2,4.73C15.29,4.73 17.1,6.7 17.1,6.7L19,4.72C19,4.72 16.56,2 12.1,2C6.42,2 2.03,6.8 2.03,12C2.03,17.05 6.16,22 12.25,22C17.6,22 21.5,18.33 21.5,12.91C21.5,11.76 21.35,11.1 21.35,11.1V11.1Z"
                      />
                    </svg>
                    <span>Connect with Google</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Settings; 