import React from 'react';
import { getEmailStoreStatus } from '../services/emailService';

interface ChatHeaderProps {
  assistantName: string;
  assistantModel: string;
  calendarEvents: number;
  emails: number;
  lastSyncTime: Date | null;
  isSyncing: boolean;
  onRestart: () => void;
  onSync: () => void;
}

export default function ChatHeader({
  assistantName,
  assistantModel,
  calendarEvents,
  emails,
  lastSyncTime,
  isSyncing,
  onRestart,
  onSync
}: ChatHeaderProps) {
  const emailStatus = getEmailStoreStatus();
  
  return (
    <div className="p-4 border-b flex items-center justify-between bg-white">
      <div>
        <h2 className="text-lg font-semibold">{assistantName}</h2>
        <p className="text-sm text-gray-500">Model: {assistantModel}</p>
        <div className="text-sm text-gray-600 mt-1">
          <p>Calendar Events: {calendarEvents}</p>
          <p>Email Store Status: 
            {emailStatus.hasData ? (
              <span className="text-green-600">
                {emailStatus.threadCount} threads, {emailStatus.messageCount} messages
              </span>
            ) : (
              <span className="text-yellow-600">Empty</span>
            )}
            {emailStatus.lastSyncError && (
              <span className="text-red-600 ml-2">
                (Last sync failed: {emailStatus.lastSyncError})
              </span>
            )}
          </p>
          <p>Last Sync: {lastSyncTime ? new Date(lastSyncTime).toLocaleString() : 'Never'}</p>
        </div>
      </div>
      <div className="flex items-center space-x-2">
        <button
          onClick={onSync}
          disabled={isSyncing}
          className={`px-3 py-1 rounded-md text-sm ${
            isSyncing
              ? 'bg-gray-300 cursor-not-allowed'
              : 'bg-blue-500 hover:bg-blue-600 text-white'
          }`}
        >
          {isSyncing ? 'Syncing...' : 'Sync Data'}
        </button>
        <button
          onClick={onRestart}
          className="px-3 py-1 bg-gray-500 hover:bg-gray-600 text-white rounded-md text-sm"
        >
          New Chat
        </button>
      </div>
    </div>
  );
} 