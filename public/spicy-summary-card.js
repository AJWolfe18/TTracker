// spicy-summary-card.js
// Component for displaying spicy summaries with share functionality
// Include this in dashboard.js
// TrumpyTracker - August 23, 2025

// Add this component to your dashboard.js file
const SpicySummaryCard = ({ article }) => {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [showShareToast, setShowShareToast] = React.useState(false);
  const [testGroup, setTestGroup] = React.useState('control');
  
  React.useEffect(() => {
    // Determine A/B test group
    const cookieValue = document.cookie
      .split('; ')
      .find(row => row.startsWith('tt_spicy_test='))
      ?.split('=')[1];
    
    if (cookieValue) {
      setTestGroup(cookieValue);
    } else {
      // Assign to test group (10% get spicy summaries initially)
      const group = Math.random() < 0.1 ? 'spicy' : 'control';
      document.cookie = `tt_spicy_test=${group}; max-age=${30*24*60*60}; path=/`;
      setTestGroup(group);
    }
  }, []);
  
  // Context-aware severity labels
  const SEVERITY_LABELS = {
    inApp: {
      critical: "Fucking Treason 🔴",
      severe: "Criminal Bullshit 🟠",
      moderate: "Swamp Shit 🟡",
      minor: "Clown Show 🟢"
    },
    shareable: {
      critical: "Democracy Under Attack",
      severe: "Criminal Corruption",
      moderate: "Swamp Business",
      minor: "Political Circus"
    }
  };
  
  // Determine which content to show based on test group
  const summary = testGroup === 'spicy' && article.spicy_summary 
    ? article.spicy_summary 
    : article.editorial_summary;
    
  const severityLabel = testGroup === 'spicy' 
    ? SEVERITY_LABELS.inApp[article.severity] || article.severity
    : article.severity;
    
  const shareableLabel = SEVERITY_LABELS.shareable[article.severity] || article.severity;
  const shareableHook = article.shareable_hook || article.title;
  
  // Share functions
  const shareToTwitter = () => {
    const text = encodeURIComponent(`${shareableHook}\n\n[${shareableLabel}] via @TrumpyTracker`);
    const url = encodeURIComponent(`https://trumpytracker.com/article/${article.id}`);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank');
  };
  
  const copyLink = () => {
    const text = `${shareableHook}\n\n[${shareableLabel}] https://trumpytracker.com/article/${article.id}`;
    navigator.clipboard.writeText(text);
    setShowShareToast(true);
    setTimeout(() => setShowShareToast(false), 3000);
  };
  
  const shareToFacebook = () => {
    const url = encodeURIComponent(`https://trumpytracker.com/article/${article.id}`);
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank');
  };
  
  // Severity styling
  const getSeverityStyle = (severity) => {
    const styles = {
      critical: 'bg-red-600 text-white font-bold',
      severe: 'bg-orange-600 text-white font-bold',
      moderate: 'bg-yellow-600 text-black font-semibold',
      minor: 'bg-green-600 text-white'
    };
    return styles[severity] || 'bg-gray-600 text-white';
  };
  
  return React.createElement('div', {
    className: 'bg-gray-800 rounded-lg p-6 mb-4 hover:shadow-xl transition-all duration-300 border border-gray-700'
  },
    // Severity Badge and Date
    React.createElement('div', {
      className: 'flex justify-between items-start mb-3'
    },
      React.createElement('span', {
        className: `px-3 py-1 rounded-full text-sm ${getSeverityStyle(article.severity)}`
      }, severityLabel),
      React.createElement('span', {
        className: 'text-gray-400 text-sm'
      }, new Date(article.date).toLocaleDateString())
    ),
    
    // Title
    React.createElement('h3', {
      className: 'text-xl font-bold text-white mb-3 hover:text-blue-400 cursor-pointer',
      onClick: () => setIsExpanded(!isExpanded)
    }, article.title),
    
    // Shareable Hook (if spicy)
    testGroup === 'spicy' && article.shareable_hook && 
      React.createElement('p', {
        className: 'text-yellow-400 font-semibold mb-3 italic text-lg border-l-4 border-yellow-400 pl-3'
      }, `"${article.shareable_hook}"`),
    
    // Summary
    React.createElement('div', {
      className: 'text-gray-300 mb-4'
    },
      React.createElement('p', {
        className: !isExpanded ? 'line-clamp-3' : ''
      }, summary),
      
      summary && summary.length > 200 && 
        React.createElement('button', {
          onClick: () => setIsExpanded(!isExpanded),
          className: 'text-blue-400 hover:text-blue-300 mt-2 text-sm font-medium'
        }, isExpanded ? '← Show less' : 'Read more →')
    ),
    
    // Actor and Categories
    React.createElement('div', {
      className: 'flex flex-wrap gap-2 mb-4'
    },
      article.actor && React.createElement('span', {
        className: 'bg-gray-700 px-2 py-1 rounded text-xs text-gray-300'
      }, article.actor),
      article.categories && article.categories.map(cat =>
        React.createElement('span', {
          key: cat,
          className: 'bg-gray-700 px-2 py-1 rounded text-xs text-gray-300'
        }, cat)
      )
    ),
    
    // Share Buttons
    React.createElement('div', {
      className: 'flex items-center gap-2 pt-4 border-t border-gray-700'
    },
      React.createElement('button', {
        onClick: shareToTwitter,
        className: 'bg-blue-500 hover:bg-blue-600 px-3 py-1.5 rounded text-white text-sm font-medium transition-colors flex items-center gap-1'
      }, '🐦 Tweet This'),
      
      React.createElement('button', {
        onClick: copyLink,
        className: 'bg-gray-600 hover:bg-gray-700 px-3 py-1.5 rounded text-white text-sm font-medium transition-colors flex items-center gap-1'
      }, '📋 Copy'),
      
      React.createElement('button', {
        onClick: shareToFacebook,
        className: 'bg-blue-700 hover:bg-blue-800 px-3 py-1.5 rounded text-white text-sm font-medium transition-colors flex items-center gap-1'
      }, '📘 Share'),
      
      article.source_url && React.createElement('a', {
        href: article.source_url,
        target: '_blank',
        rel: 'noopener noreferrer',
        className: 'ml-auto text-gray-400 hover:text-white text-sm font-medium transition-colors'
      }, 'Source →')
    ),
    
    // Share Toast Notification
    showShareToast && React.createElement('div', {
      className: 'fixed bottom-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-2xl z-50 animate-pulse'
    }, '✅ Link copied! Share the truth!')
  );
};

// Export the component
window.SpicySummaryCard = SpicySummaryCard;
