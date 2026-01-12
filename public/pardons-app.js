// TrumpyTracker Pardons Tracker
// Tracks presidential pardons with corruption analysis

(function() {
  'use strict';

  const { useState, useEffect, useCallback } = React;

  // ===========================================
  // CONFIGURATION
  // ===========================================

  const SUPABASE_URL = window.SUPABASE_CONFIG?.SUPABASE_URL || 'https://wnrjrywpcadwutfykflu.supabase.co';
  const SUPABASE_ANON_KEY = window.SUPABASE_CONFIG?.SUPABASE_ANON_KEY;

  const ITEMS_PER_PAGE = 12;

  // Connection type labels and colors
  const CONNECTION_TYPES = {
    mar_a_lago_vip: { label: 'Mar-a-Lago VIP', color: '#dc2626' },
    major_donor: { label: 'Major Donor', color: '#16a34a' },
    family: { label: 'Family', color: '#9333ea' },
    political_ally: { label: 'Political Ally', color: '#2563eb' },
    campaign_staff: { label: 'Campaign Staff', color: '#ca8a04' },
    business_associate: { label: 'Business Associate', color: '#0891b2' },
    jan6_defendant: { label: 'Jan 6 Defendant', color: '#be123c' },
    fake_electors: { label: 'Fake Elector', color: '#c026d3' },
    celebrity: { label: 'Celebrity', color: '#ea580c' },
    no_connection: { label: 'No Known Connection', color: '#6b7280' }
  };

  // Crime category labels
  const CRIME_CATEGORIES = {
    white_collar: 'White Collar',
    obstruction: 'Obstruction',
    political_corruption: 'Political Corruption',
    violent: 'Violent Crime',
    drug: 'Drug Offense',
    election: 'Election Crime',
    jan6: 'January 6th',
    other: 'Other'
  };

  // Clemency type labels
  const CLEMENCY_TYPES = {
    pardon: 'Full Pardon',
    commutation: 'Commutation',
    pre_emptive: 'Pre-emptive Pardon'
  };

  // Post-pardon status labels and colors
  const POST_PARDON_STATUSES = {
    quiet: { label: 'Staying Quiet', color: '#6b7280' },
    under_investigation: { label: 'Under Investigation', color: '#ca8a04' },
    re_offended: { label: 'Re-offended', color: '#dc2626' }
  };

  // Corruption level spicy labels (5 = most corrupt, 1 = least)
  const CORRUPTION_LABELS = {
    5: { label: 'Paid-to-Play', color: '#7f1d1d' },
    4: { label: 'Friends & Family Discount', color: '#dc2626' },
    3: { label: 'Swamp Creature', color: '#ea580c' },
    2: { label: 'Celebrity Request', color: '#ca8a04' },
    1: { label: 'Broken Clock', color: '#16a34a' }
  };

  // ===========================================
  // UTILITIES
  // ===========================================

  const timeAgo = window.TTShared?.timeAgo || function(isoDate) {
    if (!isoDate) return '';
    const ms = Date.now() - new Date(isoDate).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '';
    const seconds = Math.max(1, Math.floor(ms / 1000));
    const intervals = [[31536000,'y'],[2592000,'mo'],[604800,'w'],[86400,'d'],[3600,'h'],[60,'m']];
    for (const [sec, unit] of intervals) {
      if (seconds >= sec) return `${Math.floor(seconds / sec)}${unit} ago`;
    }
    return `${seconds}s ago`;
  };

  const formatDate = window.TTShared?.formatDate || function(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const trackEvent = window.TTShared?.trackEvent || (() => {});

  // Format currency
  function formatCurrency(amount) {
    if (!amount || amount === 0) return '$0';
    if (amount >= 1000000) {
      return `$${(amount / 1000000).toFixed(1)}M`;
    }
    if (amount >= 1000) {
      return `$${(amount / 1000).toFixed(0)}K`;
    }
    return `$${amount.toLocaleString()}`;
  }

  // Edge Function request helper
  async function edgeFunctionRequest(functionName, params = {}, signal) {
    const queryString = new URLSearchParams(params).toString();
    const url = `${SUPABASE_URL}/functions/v1/${functionName}${queryString ? '?' + queryString : ''}`;

    const response = await fetch(url, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      signal
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // ===========================================
  // THEME HOOK
  // ===========================================

  function useTheme() {
    const [theme, setThemeState] = useState(() => {
      const saved = localStorage.getItem('tt-theme');
      return saved || 'light';
    });

    const setTheme = useCallback((newTheme) => {
      setThemeState(newTheme);
      localStorage.setItem('tt-theme', newTheme);
      document.documentElement.setAttribute('data-theme', newTheme);
    }, []);

    const toggleTheme = useCallback(() => {
      const newTheme = theme === 'dark' ? 'light' : 'dark';
      setTheme(newTheme);
      trackEvent('theme_toggle', { theme: newTheme, page: 'pardons' });
    }, [theme, setTheme]);

    useEffect(() => {
      document.documentElement.setAttribute('data-theme', theme);
    }, []);

    return { theme, setTheme, toggleTheme };
  }

  // ===========================================
  // HEADER COMPONENT
  // ===========================================

  function Header({ theme, toggleTheme }) {
    return React.createElement('header', { className: 'tt-header' },
      React.createElement('div', { className: 'tt-header-inner' },
        React.createElement('a', { href: './', className: 'tt-logo' },
          React.createElement('img', {
            src: './trumpytracker-logo.jpeg',
            alt: 'TrumpyTracker',
            className: 'tt-logo-icon',
            onError: (e) => { e.target.style.display = 'none'; }
          }),
          React.createElement('div', null,
            React.createElement('div', { className: 'tt-logo-text' }, 'TrumpyTracker'),
            React.createElement('div', { className: 'tt-tagline' }, 'Tracking the Corruption. Every Damn Day.')
          )
        ),
        React.createElement('button', {
          className: 'tt-theme-toggle',
          onClick: toggleTheme,
          'aria-label': `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`
        }, theme === 'dark' ? 'Light' : 'Dark')
      )
    );
  }

  // ===========================================
  // TAB NAVIGATION
  // ===========================================

  const TABS = [
    { id: 'stories', label: 'Stories', href: './' },
    { id: 'eo', label: 'Executive Orders', href: './executive-orders.html' },
    { id: 'pardons', label: 'Pardons', href: './pardons.html' },
    { id: 'scotus', label: 'Supreme Court', href: './?tab=scotus' },
    { id: 'merch', label: 'Merchandise', href: './?tab=merch' }
  ];

  function TabNavigation({ activeTab }) {
    return React.createElement('nav', {
      role: 'navigation',
      className: 'tt-tabs',
      'aria-label': 'Main navigation'
    },
      React.createElement('div', { className: 'tt-tabs-inner' },
        TABS.map(tab =>
          React.createElement('a', {
            key: tab.id,
            href: tab.href,
            className: `tt-tab ${activeTab === tab.id ? 'active' : ''}`
          }, tab.label)
        )
      )
    );
  }

  // ===========================================
  // STATS BAR COMPONENT
  // ===========================================

  function StatsBar({ stats, loading }) {
    if (loading) {
      return React.createElement('div', { className: 'tt-stats-bar tt-stats-loading' },
        React.createElement('span', null, 'Loading stats...')
      );
    }

    if (!stats) return null;

    return React.createElement('div', { className: 'tt-stats-bar' },
      React.createElement('div', { className: 'tt-stat-item' },
        React.createElement('span', { className: 'tt-stat-value' }, stats.total_pardons || 0),
        React.createElement('span', { className: 'tt-stat-label' }, 'Pardons Tracked')
      ),
      React.createElement('div', { className: 'tt-stat-divider' }),
      React.createElement('div', { className: 'tt-stat-item' },
        React.createElement('span', { className: 'tt-stat-value' }, formatCurrency(stats.total_donations_usd || 0)),
        React.createElement('span', { className: 'tt-stat-label' }, 'Donor Connections')
      ),
      React.createElement('div', { className: 'tt-stat-divider' }),
      React.createElement('div', { className: 'tt-stat-item' },
        React.createElement('span', { className: 'tt-stat-value tt-stat-danger' }, stats.reoffended_count || 0),
        React.createElement('span', { className: 'tt-stat-label' }, 'Re-offended')
      )
    );
  }

  // ===========================================
  // CORRUPTION METER COMPONENT
  // ===========================================

  // Spicy Status - the prominent corruption label
  function SpicyStatus({ level }) {
    if (!level || level < 1 || level > 5) return null;

    const config = CORRUPTION_LABELS[level] || { label: 'Unknown', color: '#6b7280' };

    return React.createElement('div', {
      className: 'tt-spicy-status',
      title: `Corruption Level: ${level}/5`
    },
      React.createElement('span', {
        className: 'tt-spicy-label',
        style: { color: config.color }
      }, `"${config.label}"`)
    );
  }

  // ===========================================
  // PARDON CARD COMPONENT
  // ===========================================

  function PardonCard({ pardon, onViewDetail }) {
    const [expanded, setExpanded] = useState(false);

    const connectionType = CONNECTION_TYPES[pardon.primary_connection_type] || { label: 'Unknown', color: '#6b7280' };
    const summary = pardon.summary_spicy || pardon.crime_description || '';
    const hasLongSummary = summary.length > 180;
    const isGroup = pardon.recipient_type === 'group';

    return React.createElement('article', { className: 'tt-card tt-pardon-card' },
      // Header: small muted connection type + date
      React.createElement('div', { className: 'tt-card-header tt-card-header-muted' },
        React.createElement('span', { className: 'tt-meta-text' }, connectionType.label),
        React.createElement('span', { className: 'tt-meta-dot' }, '•'),
        React.createElement('span', { className: 'tt-meta-text' }, formatDate(pardon.pardon_date)),
        // Mass pardon badge for groups
        isGroup && React.createElement('span', { className: 'tt-mass-pardon-badge' }, 'MASS PARDON')
      ),

      // Recipient name
      React.createElement('h2', { className: 'tt-headline' },
        pardon.recipient_name,
        pardon.nickname && React.createElement('span', { className: 'tt-nickname' },
          ` "${pardon.nickname}"`
        )
      ),

      // Group subtitle (count only, no box)
      isGroup && React.createElement('div', { className: 'tt-group-subtitle' },
        `~${pardon.recipient_count?.toLocaleString() || '?'} people`
      ),

      // Spicy Status - THE prominent element
      React.createElement(SpicyStatus, { level: pardon.corruption_level }),

      // Summary (for groups, show criteria if no spicy summary)
      React.createElement('div', { className: 'tt-summary' },
        React.createElement('p', {
          className: `tt-summary-text ${!expanded && hasLongSummary ? 'clamped' : ''}`
        }, summary || (isGroup && pardon.recipient_criteria) || 'Details coming soon...'),
        hasLongSummary && React.createElement('button', {
          className: 'tt-expand-btn',
          onClick: () => setExpanded(!expanded),
          'aria-expanded': expanded
        }, expanded ? 'Show less ' : 'Read more ',
          React.createElement('span', { className: 'tt-chevron' }, expanded ? '' : ''))
      ),

      // Footer with action
      React.createElement('div', { className: 'tt-card-footer' },
        React.createElement('button', {
          className: 'tt-read-more',
          onClick: () => onViewDetail(pardon)
        }, 'View details')
      )
    );
  }

  // ===========================================
  // PARDON DETAIL MODAL
  // ===========================================

  function PardonDetailModal({ pardon, onClose }) {
    const [detail, setDetail] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const modalId = `pardon-detail-${pardon?.id || 'unknown'}`;

    useEffect(() => {
      if (!pardon?.id) return;

      // Reset detail when pardon changes to avoid showing stale data
      setDetail(null);
      setLoading(true);
      setError(null);

      const controller = new AbortController();

      async function loadDetail() {
        try {
          const data = await edgeFunctionRequest('pardons-detail', { id: pardon.id }, controller.signal);
          if (!controller.signal.aborted) {
            setDetail(data.pardon);
          }
        } catch (err) {
          if (!controller.signal.aborted) {
            console.error('Failed to load pardon detail:', err);
            setError(err.name === 'AbortError' ? null : err.message);
          }
        } finally {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        }
      }

      loadDetail();

      return () => controller.abort();
    }, [pardon?.id]);

    useEffect(() => {
      const handleEsc = (e) => {
        if (e.key === 'Escape') onClose();
      };
      document.addEventListener('keydown', handleEsc);
      if (window.TTShared) window.TTShared.lockScroll();
      return () => {
        document.removeEventListener('keydown', handleEsc);
        if (window.TTShared) window.TTShared.unlockScroll();
      };
    }, [onClose]);

    if (!pardon) return null;

    const p = detail || pardon;
    const connectionType = CONNECTION_TYPES[p.primary_connection_type] || { label: 'Unknown', color: '#6b7280' };
    const crimeLabel = CRIME_CATEGORIES[p.crime_category] || 'Unknown';
    const clemencyLabel = CLEMENCY_TYPES[p.clemency_type] || p.clemency_type;
    const postStatus = POST_PARDON_STATUSES[p.post_pardon_status] || { label: 'Unknown', color: '#6b7280' };
    const isGroup = p.recipient_type === 'group';

    return React.createElement('div', {
      className: 'tt-modal-overlay tt-detail-modal-overlay',
      onClick: (e) => e.target === e.currentTarget && onClose()
    },
      React.createElement('div', {
        className: 'tt-modal tt-detail-modal tt-pardon-modal',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': modalId
      },
        React.createElement('div', { className: 'tt-detail-modal-header' },
          React.createElement('button', {
            className: 'tt-modal-close',
            onClick: onClose,
            'aria-label': 'Close modal'
          }, '\u00D7')
        ),

        React.createElement('div', { className: 'tt-detail-modal-body' },
          loading && React.createElement('div', { className: 'tt-modal-loading' },
            React.createElement('div', { className: 'tt-spinner' }),
            React.createElement('p', null, 'Loading details...')
          ),

          error && React.createElement('div', { className: 'tt-modal-error' },
            React.createElement('p', null, error)
          ),

          !loading && !error && React.createElement(React.Fragment, null,
            // Header
            React.createElement('div', { className: 'tt-pardon-modal-header' },
              React.createElement('span', {
                className: 'tt-connection-badge tt-badge-large',
                style: { backgroundColor: connectionType.color }
              }, connectionType.label),
              React.createElement(CorruptionMeter, { level: p.corruption_level })
            ),

            React.createElement('h2', { id: modalId, className: 'tt-detail-headline' },
              p.recipient_name,
              p.nickname && React.createElement('span', { className: 'tt-nickname' }, ` "${p.nickname}"`)
            ),

            // Group info
            isGroup && React.createElement('div', { className: 'tt-group-indicator tt-group-large' },
              React.createElement('span', { className: 'tt-group-badge' }, 'Group Pardon'),
              React.createElement('span', { className: 'tt-group-count' },
                `Affects approximately ${p.recipient_count?.toLocaleString() || '?'} people`
              ),
              p.recipient_criteria && React.createElement('p', { className: 'tt-group-criteria' },
                p.recipient_criteria
              )
            ),

            // Section: The Pardon
            React.createElement('div', { className: 'tt-pardon-section' },
              React.createElement('h3', { className: 'tt-section-title' }, 'The Pardon'),
              React.createElement('div', { className: 'tt-section-grid' },
                React.createElement('div', { className: 'tt-section-item' },
                  React.createElement('span', { className: 'tt-item-label' }, 'Date:'),
                  React.createElement('span', { className: 'tt-item-value' }, formatDate(p.pardon_date))
                ),
                React.createElement('div', { className: 'tt-section-item' },
                  React.createElement('span', { className: 'tt-item-label' }, 'Type:'),
                  React.createElement('span', { className: 'tt-item-value' }, clemencyLabel)
                ),
                React.createElement('div', { className: 'tt-section-item' },
                  React.createElement('span', { className: 'tt-item-label' }, 'Status:'),
                  React.createElement('span', { className: 'tt-item-value' }, p.status === 'confirmed' ? 'Confirmed' : 'Reported')
                )
              )
            ),

            // Section: The Crime
            React.createElement('div', { className: 'tt-pardon-section' },
              React.createElement('h3', { className: 'tt-section-title' }, 'The Crime'),
              React.createElement('div', { className: 'tt-section-content' },
                React.createElement('span', { className: 'tt-crime-badge' }, crimeLabel),
                p.crime_description && React.createElement('p', { className: 'tt-crime-description' },
                  p.crime_description
                ),
                p.original_sentence && React.createElement('p', { className: 'tt-sentence' },
                  React.createElement('strong', null, 'Original Sentence: '),
                  p.original_sentence
                )
              )
            ),

            // Section: The Connection
            React.createElement('div', { className: 'tt-pardon-section' },
              React.createElement('h3', { className: 'tt-section-title' }, 'The Connection'),
              React.createElement('div', { className: 'tt-section-content' },
                p.trump_connection_detail ?
                  React.createElement('p', { className: 'tt-connection-detail' }, p.trump_connection_detail) :
                  React.createElement('p', { className: 'tt-connection-placeholder' }, 'Connection details coming soon...'),
                p.donation_amount_usd && p.donation_amount_usd > 0 && React.createElement('p', { className: 'tt-donation' },
                  React.createElement('strong', null, 'Known Donations: '),
                  formatCurrency(p.donation_amount_usd)
                )
              )
            ),

            // What Happened Next (if available)
            (p.post_pardon_status || p.post_pardon_notes) && React.createElement('div', { className: 'tt-pardon-section' },
              React.createElement('h3', { className: 'tt-section-title' }, 'What Happened Next'),
              React.createElement('div', { className: 'tt-section-content' },
                p.post_pardon_status && React.createElement('span', {
                  className: 'tt-post-status-badge',
                  style: { backgroundColor: postStatus.color }
                }, postStatus.label),
                p.post_pardon_notes && React.createElement('p', { className: 'tt-post-notes' },
                  p.post_pardon_notes
                )
              )
            ),

            // Source link
            p.primary_source_url && React.createElement('div', { className: 'tt-pardon-actions' },
              React.createElement('a', {
                href: p.primary_source_url,
                target: '_blank',
                rel: 'noopener noreferrer',
                className: 'tt-back-btn'
              }, 'View Source')
            )
          )
        )
      )
    );
  }

  // ===========================================
  // PAGINATION
  // ===========================================

  function Pagination({ hasMore, onLoadMore, loading }) {
    if (!hasMore) return null;

    return React.createElement('div', { className: 'tt-pagination tt-load-more' },
      React.createElement('button', {
        className: 'tt-load-more-btn',
        onClick: onLoadMore,
        disabled: loading
      }, loading ? 'Loading...' : 'Load More Pardons')
    );
  }

  // ===========================================
  // RECIPIENT TYPE FILTER
  // ===========================================

  function RecipientTypeFilter({ value, onChange }) {
    return React.createElement('div', { className: 'tt-recipient-filter' },
      React.createElement('button', {
        className: `tt-filter-pill ${value === 'all' ? 'active' : ''}`,
        onClick: () => onChange('all')
      }, 'All'),
      React.createElement('button', {
        className: `tt-filter-pill ${value === 'person' ? 'active' : ''}`,
        onClick: () => onChange('person')
      }, 'People'),
      React.createElement('button', {
        className: `tt-filter-pill ${value === 'group' ? 'active' : ''}`,
        onClick: () => onChange('group')
      }, 'Groups')
    );
  }

  // ===========================================
  // PARDONS FEED COMPONENT
  // ===========================================

  // Track current list fetch AbortController
  let listFetchController = null;

  function PardonsFeed() {
    const [pardons, setPardons] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [statsLoading, setStatsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [nextCursor, setNextCursor] = useState(null);
    const [hasMore, setHasMore] = useState(false);

    const [recipientType, setRecipientType] = useState('all');
    const [detailPardon, setDetailPardon] = useState(null);

    // Check for deep link
    useEffect(() => {
      const urlId = window.TTShared?.getUrlParam('id');
      if (urlId) {
        const idNum = Number(urlId);
        if (Number.isInteger(idNum) && idNum > 0) {
          setDetailPardon({ id: idNum });
          trackEvent('pardon_deeplink', { pardon_id: idNum });
        }
      }
    }, []);

    // Load stats
    useEffect(() => {
      const controller = new AbortController();

      async function loadStats() {
        try {
          const data = await edgeFunctionRequest('pardons-stats', {}, controller.signal);
          if (!controller.signal.aborted) {
            setStats(data);
          }
        } catch (err) {
          if (!controller.signal.aborted && err.name !== 'AbortError') {
            console.error('Failed to load stats:', err);
          }
        } finally {
          if (!controller.signal.aborted) {
            setStatsLoading(false);
          }
        }
      }

      loadStats();
      return () => controller.abort();
    }, []);

    // Memoized loadPardons with abort support
    const loadPardons = useCallback(async (cursor = null) => {
      // Abort any in-flight request
      if (listFetchController) {
        listFetchController.abort();
      }
      listFetchController = new AbortController();
      const currentController = listFetchController;

      try {
        if (cursor) {
          setLoadingMore(true);
        } else {
          setLoading(true);
          // Reset pagination state but keep stale data visible
          setNextCursor(null);
          setHasMore(false);
        }

        const params = { limit: ITEMS_PER_PAGE };
        if (cursor) params.cursor = cursor;
        if (recipientType !== 'all') params.recipient_type = recipientType;

        const data = await edgeFunctionRequest('pardons-active', params, currentController.signal);

        if (!currentController.signal.aborted) {
          if (cursor) {
            setPardons(prev => [...prev, ...(data.items || [])]);
          } else {
            setPardons(data.items || []);
          }

          setNextCursor(data.next_cursor);
          setHasMore(data.has_more);
          setError(null);
        }
      } catch (err) {
        if (!currentController.signal.aborted && err.name !== 'AbortError') {
          console.error('Failed to load pardons:', err);
          setError('Failed to load pardons. Please try again.');
        }
      } finally {
        if (!currentController.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    }, [recipientType]);

    // Load pardons when filter changes
    useEffect(() => {
      loadPardons();

      // Cleanup: abort on unmount or filter change
      return () => {
        if (listFetchController) {
          listFetchController.abort();
        }
      };
    }, [loadPardons]);

    const handleLoadMore = useCallback(() => {
      if (nextCursor && !loadingMore) {
        loadPardons(nextCursor);
        trackEvent('pardons_load_more');
      }
    }, [nextCursor, loadingMore, loadPardons]);

    const handleRecipientTypeChange = useCallback((type) => {
      setRecipientType(type);
      trackEvent('pardons_filter_recipient_type', { type });
    }, []);

    const handleViewDetail = useCallback((pardon) => {
      setDetailPardon(pardon);
      window.TTShared?.pushUrlParam('id', pardon.id);
      trackEvent('view_pardon_detail', {
        pardon_id: pardon.id,
        recipient_name: pardon.recipient_name,
        connection_type: pardon.primary_connection_type
      });
    }, []);

    const handleCloseDetail = useCallback(() => {
      setDetailPardon(null);
      window.TTShared?.removeUrlParam('id');
    }, []);

    if (loading && pardons.length === 0) {
      return React.createElement('div', { className: 'tt-loading' },
        React.createElement('div', { className: 'tt-spinner' }),
        React.createElement('p', null, 'Loading pardons...')
      );
    }

    if (error && pardons.length === 0) {
      return React.createElement('div', { className: 'tt-empty' },
        React.createElement('h3', null, 'Error Loading Pardons'),
        React.createElement('p', null, error),
        React.createElement('button', {
          onClick: () => loadPardons(),
          className: 'tt-retry-btn'
        }, 'Retry')
      );
    }

    return React.createElement(React.Fragment, null,
      // Stats bar
      React.createElement(StatsBar, { stats, loading: statsLoading }),

      // Filter bar
      React.createElement('div', { className: 'tt-pardons-filters' },
        React.createElement(RecipientTypeFilter, {
          value: recipientType,
          onChange: handleRecipientTypeChange
        }),
        React.createElement('span', { className: 'tt-results-count' },
          `${pardons.length} ${pardons.length === 1 ? 'pardon' : 'pardons'}`,
          hasMore && '+'
        )
      ),

      // Feed
      React.createElement('div', { className: 'tt-feed' },
        pardons.length === 0 && React.createElement('div', { className: 'tt-empty' },
          React.createElement('h3', null, 'No Pardons Found'),
          React.createElement('p', null, 'Try changing the filter.')
        ),

        pardons.length > 0 && React.createElement('div', { className: 'tt-grid' },
          pardons.map(pardon =>
            React.createElement(PardonCard, {
              key: pardon.id,
              pardon,
              onViewDetail: handleViewDetail
            })
          )
        ),

        React.createElement(Pagination, {
          hasMore,
          onLoadMore: handleLoadMore,
          loading: loadingMore
        })
      ),

      // Detail modal
      detailPardon && React.createElement(PardonDetailModal, {
        pardon: detailPardon,
        onClose: handleCloseDetail
      })
    );
  }

  // ===========================================
  // MAIN APP
  // ===========================================

  function PardonsApp() {
    const { theme, toggleTheme } = useTheme();

    return React.createElement('div', { className: 'tt-preview-root' },
      React.createElement(Header, { theme, toggleTheme }),
      React.createElement(TabNavigation, { activeTab: 'pardons' }),
      React.createElement(PardonsFeed)
    );
  }

  // Mount
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(React.createElement(PardonsApp));

})();
