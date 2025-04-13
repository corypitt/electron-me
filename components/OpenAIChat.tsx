import React, { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { parseGmailUrl, extractEmailUrls, isEmailRequest } from '../utils/emailUtils';
import { fetchEmailThread, createEmailDraft, formatEmailThread, syncEmails, getEmailStoreStatus, EmailMessage as StoreEmailMessage } from '../services/emailService';
import ChatHeader from './ChatHeader';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface Assistant {
  id: string;
  name: string;
  description: string | null;
  model: string;
}

interface CalendarEvent {
  summary: string;
  start: { dateTime: string };
  end: { dateTime: string };
}

export default function OpenAIChat() {
  const { data: session } = useSession();
  const [userInput, setUserInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [selectedAssistant, setSelectedAssistant] = useState<string | null>(null);
  const [currentThread, setCurrentThread] = useState<string | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [emails, setEmails] = useState<StoreEmailMessage[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [currentResponse, setCurrentResponse] = useState('');

  // Fetch assistants on component mount
  useEffect(() => {
    fetchAssistants();
  }, []);

  // Fetch calendar events and emails when session changes
  useEffect(() => {
    if (session?.accessToken) {
      syncData();
    }
  }, [session]);

  async function syncData() {
    if (isSyncing) return;
    setIsSyncing(true);
    
    try {
      // Get all emails from the store
      const emailStoreStatus = getEmailStoreStatus();
      const allEmails = emailStoreStatus.allEmails as StoreEmailMessage[];
      setEmails(allEmails);
      
      await Promise.all([
        fetchCalendarEvents(),
        syncEmails(),
      ]);
      
      // Update emails state again after sync
      const updatedStatus = getEmailStoreStatus();
      const updatedEmails = updatedStatus.allEmails as StoreEmailMessage[];
      setEmails(updatedEmails);
      
      setLastSyncTime(new Date());
    } catch (error) {
      console.error('Error syncing data:', error);
    } finally {
      setIsSyncing(false);
    }
  }

  async function restartChat() {
    setMessages([]);
    setCurrentThread(null);
    const newThreadId = await createThread();
    if (newThreadId) {
      setCurrentThread(newThreadId);
    }
  }

  async function fetchEmails() {
    try {
      await syncEmails();
    } catch (error) {
      console.error('Error fetching emails:', error);
    }
  }

  async function fetchCalendarEvents() {
    try {
      const response = await fetch('/api/google/calendar?weeks=2');
      const data = await response.json();
      setCalendarEvents(data.events);
    } catch (error) {
      console.error('Error fetching calendar events:', error);
    }
  }

  async function fetchAssistants() {
    try {
      const response = await fetch('/api/openai/assistants');
      const data = await response.json();
      setAssistants(data.data);
      if (data.data.length > 0) {
        setSelectedAssistant(data.data[0].id);
      }
    } catch (error) {
      console.error('Error fetching assistants:', error);
    }
  }

  async function createThread() {
    try {
      const response = await fetch('/api/openai/threads', {
        method: 'POST',
      });
      const data = await response.json();
      setCurrentThread(data.id);
      return data.id;
    } catch (error) {
      console.error('Error creating thread:', error);
      return null;
    }
  }

  async function handleEmailDraft(emailUrl: string) {
    try {
      const response = await fetch('/api/google/gmail/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          threadId: emailUrl.split('/').pop(),
          content: messages[messages.length - 1].content 
        }),
      });
      const data = await response.json();
      if (data.success) {
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: 'Email draft has been created successfully!' 
        }]);
      }
    } catch (error) {
      console.error('Error creating email draft:', error);
    }
  }

  async function handleSend() {
    if (!userInput.trim() || !selectedAssistant) return;

    setIsLoading(true);
    const inputText = userInput;
    setUserInput('');
    
    try {
      console.log('[OpenAIChat] Starting message send...');
      const threadId = currentThread || await createThread();
      if (!threadId) {
        throw new Error('Failed to create or get thread');
      }
      console.log('[OpenAIChat] Using thread:', threadId);

      // Add user message immediately
      const newUserMessage: Message = { role: 'user', content: inputText };
      setMessages(prevMessages => [...prevMessages, newUserMessage]);
      console.log('[OpenAIChat] Added user message');

      // Add placeholder for assistant's message
      const assistantMessage: Message = { role: 'assistant', content: '' };
      setMessages(prevMessages => [...prevMessages, assistantMessage]);
      console.log('[OpenAIChat] Added assistant placeholder');

      // Build context message
      let contextMessage = '';
      
      // Add email context if relevant
      if (isEmailRequest(inputText)) {
        // Extract email URLs from the message
        const emailUrls = extractEmailUrls(inputText);
        
        // If we have email URLs, fetch their content
        if (emailUrls.length > 0) {
          contextMessage += '\nREQUESTED EMAIL THREAD(S):\n' + '-'.repeat(30) + '\n';
          for (const url of emailUrls) {
            const { threadId: emailThreadId, isValid } = parseGmailUrl(url);
            if (isValid && emailThreadId) {
              const thread = await fetchEmailThread(emailThreadId);
              if (thread) {
                contextMessage += formatEmailThread(thread);
              }
            }
          }
        }

        // Add recent emails context if no specific thread requested
        if (emails.length > 0 && !emailUrls.length) {
          contextMessage += '\nRECENT EMAILS:\n' + '-'.repeat(30) + '\n';
          // Sort emails by date, newest first
          const sortedEmails = [...emails].sort((a, b) => 
            new Date(b.date).getTime() - new Date(a.date).getTime()
          );
          
          // Take the 10 most recent emails
          sortedEmails.slice(0, 10).forEach(email => {
            const date = new Date(email.date).toLocaleString();
            contextMessage += `\nFrom: ${email.from}\nDate: ${date}\nSubject: ${email.subject}\nPreview: ${email.snippet}\n${'-'.repeat(30)}\n`;
          });

          contextMessage += `\nTotal emails in store: ${emails.length}\n`;
        }
      }

      // Add calendar context if relevant
      if (calendarEvents.length > 0 && (isEmailRequest(inputText) || inputText.toLowerCase().includes('schedule'))) {
        contextMessage += '\nCALENDAR EVENTS (Next 2 Weeks):\n' + '-'.repeat(30) + '\n';
        const eventsByDate = calendarEvents.reduce((acc: { [key: string]: CalendarEvent[] }, event) => {
          const date = new Date(event.start.dateTime).toLocaleDateString();
          if (!acc[date]) {
            acc[date] = [];
          }
          acc[date].push(event);
          return acc;
        }, {});

        Object.entries(eventsByDate).forEach(([date, events]) => {
          contextMessage += `\n${date}:\n`;
          events.forEach(event => {
            const startTime = new Date(event.start.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const endTime = new Date(event.end.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            contextMessage += `- ${event.summary}: ${startTime} - ${endTime}\n`;
          });
        });
      }

      console.log('[OpenAIChat] Sending request to API with context...');
      const response = await fetch(`/api/openai/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: inputText,
          assistant_id: selectedAssistant,
          context: contextMessage,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No response body available');
      }

      console.log('[OpenAIChat] Starting to read response stream...');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          console.log('[OpenAIChat] Stream complete');
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        console.log('[OpenAIChat] Received chunk:', chunk);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;

          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            console.log('[OpenAIChat] Received [DONE] signal');
            continue;
          }

          try {
            const event = JSON.parse(data);
            console.log('[OpenAIChat] Parsed event:', event);
            
            if (event.type === 'content_block_delta' && event.delta?.text) {
              accumulatedText += event.delta.text;
              console.log('[OpenAIChat] Updating message with text:', accumulatedText);
              
              setMessages(prevMessages => {
                const newMessages = [...prevMessages];
                const lastMessage = newMessages[newMessages.length - 1];
                if (lastMessage && lastMessage.role === 'assistant') {
                  lastMessage.content = accumulatedText;
                }
                return newMessages;
              });
            }
          } catch (err) {
            console.error('[OpenAIChat] Error processing chunk:', err, 'Raw line:', line);
          }
        }
      }
    } catch (error) {
      console.error('[OpenAIChat] Error in handleSend:', error);
      setMessages(prevMessages => {
        const newMessages = [...prevMessages];
        const lastMessage = newMessages[newMessages.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
          lastMessage.content = 'Error: Failed to get response';
        }
        return newMessages;
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      <ChatHeader
        assistantName={assistants.find(a => a.id === selectedAssistant)?.name || 'Assistant'}
        assistantModel={assistants.find(a => a.id === selectedAssistant)?.model || ''}
        calendarEvents={calendarEvents.length}
        emails={emails.length}
        lastSyncTime={lastSyncTime}
        isSyncing={isSyncing}
        onRestart={restartChat}
        onSync={syncData}
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg p-3 ${
                message.role === 'user'
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-200 text-gray-800'
              }`}
            >
              <div className="whitespace-pre-wrap">{message.content}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 border-t">
        <div className="flex space-x-2">
          <textarea
            rows={2}
            className="flex-1 p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            placeholder={session ? "Ask a question..." : "Please sign in to use the chat"}
            disabled={!session || isLoading}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !userInput.trim() || !selectedAssistant || !session}
            className={`px-4 py-2 rounded-md text-white ${
              isLoading || !userInput.trim() || !selectedAssistant || !session
                ? 'bg-green-300 cursor-not-allowed'
                : 'bg-green-500 hover:bg-green-600'
            } transition-colors`}
          >
            {isLoading ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
} 