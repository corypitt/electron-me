interface EmailUrlInfo {
  threadId: string;
  isValid: boolean;
}

export function parseGmailUrl(url: string): EmailUrlInfo {
  try {
    console.log('[emailUtils] Parsing Gmail URL:', url);
    if (!url) {
      console.error('[emailUtils] Empty URL provided');
      return { threadId: '', isValid: false };
    }

    const cleanUrl = url.startsWith('@') ? url.slice(1) : url;
    
    // Check if URL is incomplete (just base URL)
    if (cleanUrl.match(/^https:\/\/mail\.google\.com\/mail\/u\/\d+\/?$/)) {
      console.error('[emailUtils] Incomplete Gmail URL - missing thread ID');
      return { threadId: '', isValid: false };
    }

    // Try different Gmail URL patterns
    const patterns = [
      // Standard format with hash and thread ID
      /https:\/\/mail\.google\.com\/mail\/u\/\d+\/#(?:inbox|sent|all|search)\/([a-zA-Z0-9_-]{16,})/,
      // Format without hash but with thread ID
      /https:\/\/mail\.google\.com\/mail\/u\/\d+\/(?:inbox|sent|all|search)\/([a-zA-Z0-9_-]{16,})/,
      // Format with different path structure and thread ID
      /mail\.google\.com\/mail\/.*?\/([a-zA-Z0-9_-]{16,})(?:[/?#]|$)/,
      // Most permissive - just extract what looks like a thread ID
      /[#/]([a-zA-Z0-9_-]{16,})(?:[/?#]|$)/,
      // Direct thread ID format
      /^([a-zA-Z0-9_-]{16,})$/
    ];

    for (const pattern of patterns) {
      const match = cleanUrl.match(pattern);
      if (match?.[1]) {
        const threadId = match[1].trim();
        if (threadId.length < 16) {
          console.error('[emailUtils] Thread ID too short:', threadId);
          continue;
        }
        console.log('[emailUtils] Matched pattern:', pattern, 'Thread ID:', threadId);
        return {
          threadId,
          isValid: true
        };
      }
    }
    
    // If all patterns fail, try to extract what looks like a thread ID
    const segments = cleanUrl.split(/[/?#]/).filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    if (lastSegment && /^[a-zA-Z0-9_-]{16,}$/.test(lastSegment)) {
      console.log('[emailUtils] Extracted thread ID from last segment:', lastSegment);
      return {
        threadId: lastSegment,
        isValid: true
      };
    }
    
    // Log the URL structure to help with debugging
    console.error('[emailUtils] Invalid Gmail URL structure:', {
      url: cleanUrl,
      segments: segments,
      lastSegment: lastSegment
    });
    return {
      threadId: '',
      isValid: false
    };
  } catch (error) {
    console.error('[emailUtils] Error parsing Gmail URL:', error);
    return {
      threadId: '',
      isValid: false
    };
  }
}

export function extractEmailUrls(text: string): string[] {
  try {
    console.log('[emailUtils] Extracting email URLs from text');
    // Match Gmail URLs with optional @ prefix and thread ID
    const patterns = [
      /@?https:\/\/mail\.google\.com\/mail\/.*?\/[a-zA-Z0-9_-]{16,}(?:[/?#]|$)/g,
      /(?:^|\s)([a-zA-Z0-9_-]{16,})(?:\s|$)/g  // Match bare thread IDs
    ];
    
    const urls = new Set<string>();
    for (const pattern of patterns) {
      const matches = text.match(pattern) || [];
      matches.forEach(match => {
        const cleaned = match.trim();
        if (cleaned && cleaned.length >= 16) {
          urls.add(cleaned);
        }
      });
    }
    
    const result = Array.from(urls);
    console.log('[emailUtils] Found URLs:', result);
    return result;
  } catch (error) {
    console.error('[emailUtils] Error extracting email URLs:', error);
    return [];
  }
}

export function isEmailRequest(text: string): boolean {
  const lowerText = text.toLowerCase();
  return (
    lowerText.includes('email') ||
    lowerText.includes('gmail') ||
    lowerText.includes('mail.google.com') ||
    lowerText.includes('draft') ||
    lowerText.includes('reply') ||
    lowerText.includes('respond') ||
    /[a-zA-Z0-9_-]{16,}/.test(text)  // Also check for thread ID-like patterns
  );
} 