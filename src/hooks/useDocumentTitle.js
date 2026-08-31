import { useEffect } from 'react';

// Sets the browser tab title for as long as this component is mounted.
// Every page here can be opened in its own tab — bids, projects, meetings,
// every top-bar dropdown item, the document viewer — and without this they
// all show the same generic app title, so there's no way to tell tabs apart
// from the taskbar/tab strip alone. No restore-on-unmount: each of these
// pages is either the only view a fresh tab will ever show, or the next
// mounted page will set its own title immediately anyway.
export function useDocumentTitle(title) {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}
