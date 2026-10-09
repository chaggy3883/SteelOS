import React from 'react';
import { AlertTriangle, RotateCw, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

// No top-level error boundary existed anywhere in this app before this file
// — any render exception anywhere blanked the whole page with no recovery
// path (white/black screen, nothing in the UI, only a stack trace in the
// console). This is a plain class component because getDerivedStateFromError/
// componentDidCatch have no hook equivalent.
//
// Two instances are mounted: one wrapping the whole routed app (App.jsx) as
// a last-resort catch-all, and one scoped around the IRONSIGHT workspace
// (BlueprintTakeoff.jsx) specifically, since that page's PDF/canvas code is
// this app's most exception-prone surface — the inner boundary lets an
// IRONSIGHT crash recover back to that page's own session list instead of
// taking down the entire app shell.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}] Caught render error`, error, info?.componentStack);
  }

  handleReset = () => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-[50vh] w-full flex items-center justify-center p-6">
        <div className="max-w-lg w-full rounded-lg border border-destructive/30 bg-destructive/5 p-6 space-y-4">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <h2 className="font-semibold text-lg">{this.props.title || 'Something went wrong'}</h2>
          </div>
          <p className="text-sm text-muted-foreground break-words">
            {error?.message || 'An unexpected error occurred.'}
          </p>
          <p className="text-xs text-muted-foreground">
            The full error has been logged to the browser console.
          </p>
          <div className="flex items-center gap-2">
            {this.props.onReset && (
              <Button size="sm" variant="outline" onClick={this.handleReset}>
                <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />{this.props.resetLabel || 'Back'}
              </Button>
            )}
            <Button size="sm" onClick={this.handleReload}>
              <RotateCw className="w-3.5 h-3.5 mr-1.5" />Reload
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
