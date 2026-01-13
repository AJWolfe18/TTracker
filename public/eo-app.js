// TrumpyTracker EO Theme Preview - Executive Orders Page
// Matches story theme styling with EO-specific content

(function() {
  'use strict';

  const { useState, useEffect, useMemo, useRef, useCallback } = React;

  // ===========================================
  // CONFIGURATION
  // ===========================================

  const SUPABASE_URL = window.SUPABASE_CONFIG?.SUPABASE_URL || 'https://wnrjrywpcadwutfykflu.supabase.co';
  const SUPABASE_ANON_KEY = window.SUPABASE_CONFIG?.SUPABASE_ANON_KEY;

  const ITEMS_PER_PAGE = 12;

  // EO Category labels (match database values)
  const EO_CATEGORIES = {
    health_care: 'Health Care',
    gov_ops_workforce: 'Government & Workforce',
    economy_jobs_taxes: 'Economy & Jobs',
    justice_civil_rights_voting: 'Justice & Civil Rights',
    infra_housing_transport: 'Infrastructure',
    immigration_border: 'Immigration & Border',
    environment_energy: 'Environment & Energy',
    natsec_foreign: 'National Security',
    education_science: 'Education & Science',
    other: 'Other'
  };

  // Impact type labels (match database eo_impact_type values)
  const IMPACT_LABELS = {
    fascist_power_grab: 'Fascist Power Grab',
    authoritarian_overreach: 'Authoritarian Overreach',
    performative_bullshit: 'Performative Bullshit',
    corrupt_grift: 'Corrupt Grift'
  };

  // Impact type colors
  const IMPACT_COLORS = {
    fascist_power_grab: 'critical',
    authoritarian_overreach: 'severe',
    performative_bullshit: 'minor',
    corrupt_grift: 'moderate'
  };

  // Action tier labels
  const ACTION_TIERS = {
    immediate: 'Act Now',
    watch: 'Watch Closely',
    monitor: 'Monitor',
    informational: 'Info Only'
  };

  // ===========================================
  // UTILITIES
  // ===========================================

  function timeAgo(isoDate) {
    if (!isoDate) return '';
    const ms = Date.now() - new Date(isoDate).getTime();
    if (!Number.isFinite(ms) || ms < 0) return '';
    const seconds = Math.max(1, Math.floor(ms / 1000));

    const intervals = [
      [31536000, 'y'],
      [2592000, 'mo'],
      [604800, 'w'],
      [86400, 'd'],
      [3600, 'h'],
      [60, 'm']
    ];

    for (const [sec, unit] of intervals) {
      if (seconds >= sec) {
        return `${Math.floor(seconds / sec)}${unit} ago`;
      }
    }
    return `${seconds}s ago`;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  async function supabaseRequest(query) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Supabase error: ${response.status}`);
    }

    return response.json();
  }

  // Analytics tracking helper (from shared.js)
  const trackEvent = window.TTShared?.trackEvent || (() => {});

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
      trackEvent('theme_toggle', { theme: newTheme, page: 'executive_orders' });
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
        }, theme === 'dark' ? '☀️ Light' : '🌙 Dark')
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
  // FILTERS COMPONENT
  // ===========================================

  function FiltersSection({
    searchTerm,
    onSearchChange,
    selectedCategory,
    onCategoryChange,
    selectedImpact,
    onImpactChange,
    categories,
    filteredCount,
    totalCount,
    onClearAll
  }) {
    const hasActiveFilters = selectedCategory !== 'all' || selectedImpact !== 'all' || searchTerm.trim() !== '';

    return React.createElement('div', { className: 'tt-filters' },
      React.createElement('div', { className: 'tt-filters-row' },
        React.createElement('div', { className: 'tt-search-wrapper' },
          React.createElement('span', { className: 'tt-search-icon' }, '🔍'),
          React.createElement('input', {
            type: 'text',
            className: 'tt-search',
            placeholder: 'Search executive orders...',
            value: searchTerm,
            onChange: (e) => onSearchChange(e.target.value)
          })
        ),

        React.createElement('select', {
          className: 'tt-dropdown',
          value: selectedCategory,
          onChange: (e) => onCategoryChange(e.target.value),
          'aria-label': 'Filter by category'
        },
          React.createElement('option', { value: 'all' }, 'All Categories'),
          ...categories.map(cat =>
            React.createElement('option', { key: cat, value: cat }, EO_CATEGORIES[cat] || cat)
          )
        ),

        React.createElement('select', {
          className: 'tt-dropdown',
          value: selectedImpact,
          onChange: (e) => onImpactChange(e.target.value),
          'aria-label': 'Filter by impact'
        },
          React.createElement('option', { value: 'all' }, 'All Impact Levels'),
          Object.entries(IMPACT_LABELS).map(([value, label]) =>
            React.createElement('option', { key: value, value }, label)
          )
        )
      ),

      React.createElement('div', { className: 'tt-filters-status' },
        React.createElement('span', { className: 'tt-results-count' },
          `${filteredCount} ${filteredCount === 1 ? 'order' : 'orders'}`,
          filteredCount !== totalCount && ` (of ${totalCount})`
        ),

        hasActiveFilters && React.createElement('div', { className: 'tt-active-filters' },
          selectedCategory !== 'all' && React.createElement('span', { className: 'tt-filter-chip' },
            `Category: ${EO_CATEGORIES[selectedCategory] || selectedCategory}`,
            React.createElement('button', {
              className: 'tt-chip-remove',
              onClick: () => onCategoryChange('all')
            }, '×')
          ),
          selectedImpact !== 'all' && React.createElement('span', { className: 'tt-filter-chip' },
            `Impact: ${IMPACT_LABELS[selectedImpact] || selectedImpact}`,
            React.createElement('button', {
              className: 'tt-chip-remove',
              onClick: () => onImpactChange('all')
            }, '×')
          ),
          searchTerm.trim() && React.createElement('span', { className: 'tt-filter-chip' },
            `Search: "${searchTerm.trim().substring(0, 20)}..."`,
            React.createElement('button', {
              className: 'tt-chip-remove',
              onClick: () => onSearchChange('')
            }, '×')
          ),
          React.createElement('button', {
            className: 'tt-clear-all',
            onClick: onClearAll
          }, 'Clear all')
        )
      )
    );
  }

  // ===========================================
  // EO CARD COMPONENT
  // ===========================================

  function EOCard({ eo, onViewAnalysis }) {
    const [expanded, setExpanded] = useState(false);

    const categoryLabel = EO_CATEGORIES[eo.category] || 'Uncategorized';
    const impactLabel = IMPACT_LABELS[eo.eo_impact_type] || '';
    const impactColor = IMPACT_COLORS[eo.eo_impact_type] || 'minor';
    const actionTier = ACTION_TIERS[eo.action_tier] || '';
    const summary = eo.section_what_it_means || eo.title || '';
    const hasLongSummary = summary.length > 200;

    return React.createElement('article', { className: 'tt-card' },
      React.createElement('div', { className: 'tt-card-header' },
        React.createElement('span', { className: 'tt-eo-badge' },
          `EO ${eo.order_number || ''}`
        ),
        React.createElement('span', { className: 'tt-timestamp' },
          formatDate(eo.date || eo.created_at)
        )
      ),

      React.createElement('h2', { className: 'tt-headline' }, eo.title),

      React.createElement('div', { className: 'tt-eo-meta-row' },
        React.createElement('span', {
          className: 'tt-category',
          'data-cat': eo.category
        }, categoryLabel),
        impactLabel && React.createElement('span', {
          className: 'tt-severity',
          'data-severity': impactColor
        }, impactLabel),
        actionTier && React.createElement('span', { className: 'tt-action-tier' }, actionTier)
      ),

      React.createElement('div', { className: 'tt-summary' },
        React.createElement('p', {
          className: `tt-summary-text ${!expanded && hasLongSummary ? 'clamped' : ''}`
        }, summary),
        hasLongSummary && React.createElement('button', {
          className: 'tt-expand-btn',
          onClick: () => setExpanded(!expanded),
          'aria-expanded': expanded
        }, expanded ? 'Show less ' : 'Expand summary ',
          React.createElement('span', { className: 'tt-chevron' }, expanded ? '▲' : '▼'))
      ),

      React.createElement('div', { className: 'tt-card-footer' },
        eo.source_url && React.createElement('a', {
          href: eo.source_url,
          target: '_blank',
          rel: 'noopener noreferrer',
          className: 'tt-sources-btn'
        },
          React.createElement('span', { className: 'tt-btn-icon' }, '📄'),
          'Official Text'
        ),
        React.createElement('button', {
          className: 'tt-read-more',
          onClick: () => onViewAnalysis(eo)
        },
          'View analysis ',
          React.createElement('span', { className: 'tt-arrow-icon' }, '↗')
        )
      )
    );
  }

  // ===========================================
  // EO DETAIL MODAL
  // ===========================================

  function EODetailModal({ eo, onClose }) {
    const modalId = `eo-detail-${eo?.id || 'unknown'}`;

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

    if (!eo) return null;

    const sections = [
      { key: 'section_what_they_say', title: 'What They Say' },
      { key: 'section_what_it_means', title: 'What It Actually Means' },
      { key: 'section_reality_check', title: 'Reality Check' },
      { key: 'section_why_it_matters', title: 'Why This Matters' }
    ];

    return React.createElement('div', {
      className: 'tt-modal-overlay tt-detail-modal-overlay',
      onClick: (e) => e.target === e.currentTarget && onClose()
    },
      React.createElement('div', {
        className: 'tt-modal tt-detail-modal',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': modalId
      },
        React.createElement('div', { className: 'tt-detail-modal-header' },
          React.createElement('button', {
            className: 'tt-modal-close',
            onClick: onClose,
            'aria-label': 'Close modal'
          }, '×')
        ),

        React.createElement('div', { className: 'tt-detail-modal-body' },
          React.createElement('span', { className: 'tt-eo-badge tt-eo-badge-large' },
            `EO ${eo.order_number || ''}`
          ),

          React.createElement('h2', {
            id: modalId,
            className: 'tt-detail-headline'
          }, eo.title),

          React.createElement('div', { className: 'tt-detail-meta' },
            React.createElement('span', { className: 'tt-detail-date' },
              'Signed: ',
              formatDate(eo.date || eo.created_at)
            ),
            eo.eo_impact_type && React.createElement('span', {
              className: 'tt-severity',
              'data-severity': IMPACT_COLORS[eo.eo_impact_type] || 'minor'
            }, IMPACT_LABELS[eo.eo_impact_type]),
            eo.action_tier && React.createElement('span', { className: 'tt-action-tier' },
              ACTION_TIERS[eo.action_tier]
            )
          ),

          sections.map(section =>
            eo[section.key] && React.createElement('div', {
              key: section.key,
              className: 'tt-eo-section'
            },
              React.createElement('h3', { className: 'tt-eo-section-title' }, section.title),
              React.createElement('p', { className: 'tt-eo-section-content' }, eo[section.key])
            )
          ),

          eo.source_url && React.createElement('div', { className: 'tt-eo-actions' },
            React.createElement('a', {
              href: eo.source_url,
              target: '_blank',
              rel: 'noopener noreferrer',
              className: 'tt-back-btn',
              onClick: () => {
                if (window.TTShared?.trackOutboundClick) {
                  try {
                    const domain = new URL(eo.source_url).hostname;
                    window.TTShared.trackOutboundClick({
                      targetType: 'official_source',
                      sourceDomain: domain,
                      contentType: 'executive_order',
                      contentId: String(eo.id)
                    });
                  } catch (e) { /* ignore URL parse errors */ }
                }
              }
            }, 'View Official Text ↗')
          )
        )
      )
    );
  }

  // ===========================================
  // PAGINATION
  // ===========================================

  function Pagination({ currentPage, totalPages, onPageChange }) {
    if (totalPages <= 1) return null;

    const pages = [];
    const maxVisible = 5;
    let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let end = Math.min(totalPages, start + maxVisible - 1);
    if (end - start + 1 < maxVisible) start = Math.max(1, end - maxVisible + 1);
    for (let i = start; i <= end; i++) pages.push(i);

    return React.createElement('div', { className: 'tt-pagination' },
      React.createElement('button', {
        className: 'tt-page-btn',
        onClick: () => onPageChange(currentPage - 1),
        disabled: currentPage === 1
      }, '←'),
      start > 1 && React.createElement('button', {
        className: 'tt-page-btn',
        onClick: () => onPageChange(1)
      }, '1'),
      start > 2 && React.createElement('span', { style: { color: 'var(--text-muted)' } }, '...'),
      ...pages.map(page =>
        React.createElement('button', {
          key: page,
          className: `tt-page-btn ${page === currentPage ? 'active' : ''}`,
          onClick: () => onPageChange(page)
        }, page)
      ),
      end < totalPages - 1 && React.createElement('span', { style: { color: 'var(--text-muted)' } }, '...'),
      end < totalPages && React.createElement('button', {
        className: 'tt-page-btn',
        onClick: () => onPageChange(totalPages)
      }, totalPages),
      React.createElement('button', {
        className: 'tt-page-btn',
        onClick: () => onPageChange(currentPage + 1),
        disabled: currentPage === totalPages
      }, '→')
    );
  }

  // ===========================================
  // EO FEED COMPONENT
  // ===========================================

  function EOFeed() {
    const [allEOs, setAllEOs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [selectedImpact, setSelectedImpact] = useState('all');
    const [page, setPage] = useState(1);

    const [detailEO, setDetailEO] = useState(null);

    const searchDebounceRef = useRef(null);

    useEffect(() => {
      loadEOs();
    }, []);

    async function loadEOs() {
      try {
        setLoading(true);
        const data = await supabaseRequest(
          'executive_orders?select=id,order_number,title,date,category,eo_impact_type,action_tier,section_what_it_means,section_what_they_say,section_reality_check,section_why_it_matters,source_url,created_at&order=date.desc,id.desc&limit=500'
        );
        setAllEOs(data || []);
        setError(null);
      } catch (err) {
        console.error('Failed to load executive orders:', err);
        setError('Failed to load executive orders. Please try again.');
      } finally {
        setLoading(false);
      }
    }

    const filteredEOs = useMemo(() => {
      let result = [...allEOs];

      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        result = result.filter(eo =>
          eo.title?.toLowerCase().includes(term) ||
          eo.order_number?.toLowerCase().includes(term) ||
          eo.section_what_it_means?.toLowerCase().includes(term)
        );
      }

      if (selectedCategory !== 'all') {
        result = result.filter(eo => eo.category === selectedCategory);
      }

      if (selectedImpact !== 'all') {
        result = result.filter(eo => eo.eo_impact_type === selectedImpact);
      }

      return result;
    }, [allEOs, searchTerm, selectedCategory, selectedImpact]);

    const totalPages = Math.ceil(filteredEOs.length / ITEMS_PER_PAGE);
    const paginatedEOs = useMemo(() => {
      const start = (page - 1) * ITEMS_PER_PAGE;
      return filteredEOs.slice(start, start + ITEMS_PER_PAGE);
    }, [filteredEOs, page]);

    const categories = useMemo(() => {
      const cats = new Set(allEOs.map(eo => eo.category).filter(Boolean));
      return Array.from(cats).sort();
    }, [allEOs]);

    const handleSearchChange = useCallback((value) => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => {
        setSearchTerm(value);
        setPage(1);
        if (value.trim()) {
          trackEvent('search', { search_term: value.trim(), page: 'executive_orders' });
        }
      }, 300);
    }, []);

    const handleClearAll = useCallback(() => {
      setSearchTerm('');
      setSelectedCategory('all');
      setSelectedImpact('all');
      setPage(1);
    }, []);

    if (loading) {
      return React.createElement('div', { className: 'tt-loading' },
        React.createElement('div', { className: 'tt-spinner' }),
        React.createElement('p', null, 'Loading executive orders...')
      );
    }

    if (error) {
      return React.createElement('div', { className: 'tt-empty' },
        React.createElement('h3', null, 'Error Loading Executive Orders'),
        React.createElement('p', null, error),
        React.createElement('button', {
          onClick: loadEOs,
          className: 'tt-retry-btn'
        }, 'Retry')
      );
    }

    return React.createElement(React.Fragment, null,
      React.createElement(FiltersSection, {
        searchTerm,
        onSearchChange: handleSearchChange,
        selectedCategory,
        onCategoryChange: (cat) => { setSelectedCategory(cat); setPage(1); trackEvent('filter_category', { category: cat, page: 'executive_orders' }); },
        selectedImpact,
        onImpactChange: (imp) => { setSelectedImpact(imp); setPage(1); trackEvent('filter_impact', { impact: imp, page: 'executive_orders' }); },
        categories,
        filteredCount: filteredEOs.length,
        totalCount: allEOs.length,
        onClearAll: handleClearAll
      }),

      React.createElement('div', { className: 'tt-feed' },
        paginatedEOs.length === 0 && React.createElement('div', { className: 'tt-empty' },
          React.createElement('h3', null, 'No Executive Orders Found'),
          React.createElement('p', null, 'Try adjusting your filters.'),
          (selectedCategory !== 'all' || selectedImpact !== 'all' || searchTerm.trim()) &&
            React.createElement('button', {
              className: 'tt-retry-btn',
              onClick: handleClearAll
            }, 'Clear all filters')
        ),

        paginatedEOs.length > 0 && React.createElement('div', { className: 'tt-grid' },
          paginatedEOs.map(eo =>
            React.createElement(EOCard, {
              key: eo.id,
              eo,
              onViewAnalysis: (eo) => {
                setDetailEO(eo);
                if (window.TTShared?.trackDetailOpen) {
                  window.TTShared.trackDetailOpen({
                    objectType: 'eo',
                    contentType: 'executive_order',
                    contentId: String(eo.id),
                    source: 'card_click'
                  });
                }
              }
            })
          )
        ),

        React.createElement(Pagination, {
          currentPage: page,
          totalPages,
          onPageChange: (p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); trackEvent('pagination', { page: p, page_name: 'executive_orders' }); }
        })
      ),

      detailEO && React.createElement(EODetailModal, {
        eo: detailEO,
        onClose: () => {
          if (window.TTShared?.trackDetailClose) {
            window.TTShared.trackDetailClose({
              objectType: 'eo',
              contentType: 'executive_order',
              contentId: String(detailEO.id)
            });
          }
          setDetailEO(null);
        }
      })
    );
  }

  // ===========================================
  // NEWSLETTER COMPONENTS
  // ===========================================

  // Newsletter Form (reusable for footer and inline)
  function NewsletterForm({ signupPage, signupSource, isInline = false }) {
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState('idle');
    const [message, setMessage] = useState('');
    const [showTurnstile, setShowTurnstile] = useState(false);
    const turnstileRef = useRef(null);
    const turnstileWidgetId = useRef(null);

    useEffect(() => {
      if (!showTurnstile) return;
      if (window.turnstile && turnstileRef.current && !turnstileWidgetId.current) {
        turnstileWidgetId.current = window.turnstile.render(turnstileRef.current, {
          sitekey: window.TTShared?.TURNSTILE_SITE_KEY || '0x4AAAAAACMTyFRQ0ebtcHkK',
          callback: () => {},
          'error-callback': () => console.warn('[Turnstile] Widget error')
        });
      }
      return () => {
        if (turnstileWidgetId.current && window.turnstile) {
          window.turnstile.remove(turnstileWidgetId.current);
          turnstileWidgetId.current = null;
        }
      };
    }, [showTurnstile]);

    const handleSubmit = async (e) => {
      e.preventDefault();
      if (!email.trim()) {
        setStatus('error');
        setMessage('Please enter your email address.');
        return;
      }
      let turnstileToken = '';
      if (window.turnstile && turnstileWidgetId.current) {
        turnstileToken = window.turnstile.getResponse(turnstileWidgetId.current);
        if (!turnstileToken) {
          setStatus('error');
          setMessage('Please complete the verification.');
          return;
        }
      }
      setStatus('loading');
      setMessage('');
      const result = await window.TTShared.submitNewsletterSignup({
        email: email.trim(), turnstileToken, signupPage, signupSource
      });
      if (result.success) {
        setStatus('success');
        setMessage(result.message);
        setEmail('');
        if (window.turnstile && turnstileWidgetId.current) window.turnstile.reset(turnstileWidgetId.current);
      } else {
        setStatus('error');
        setMessage(result.message);
        if (window.turnstile && turnstileWidgetId.current) window.turnstile.reset(turnstileWidgetId.current);
      }
    };

    if (window.TTShared?.hasNewsletterSignup()) return null;

    return React.createElement('form', { className: 'tt-newsletter-form', onSubmit: handleSubmit },
      React.createElement('input', { type: 'text', name: 'website', className: 'tt-newsletter-hp', tabIndex: -1, autoComplete: 'off' }),
      React.createElement('input', { type: 'email', className: 'tt-newsletter-input', placeholder: 'Enter your email', value: email, onChange: (e) => setEmail(e.target.value), onFocus: () => setShowTurnstile(true), disabled: status === 'loading', 'aria-label': 'Email address' }),
      React.createElement('button', { type: 'submit', className: 'tt-newsletter-submit', disabled: status === 'loading' }, status === 'loading' ? 'Subscribing...' : 'Subscribe'),
      showTurnstile && React.createElement('div', { className: 'tt-newsletter-turnstile', ref: turnstileRef }),
      message && React.createElement('div', { className: `tt-newsletter-message ${status}` }, message),
      React.createElement('p', { className: 'tt-newsletter-privacy' }, 'No spam, ever. Unsubscribe anytime.')
    );
  }

  function NewsletterFooter() {
    if (window.TTShared?.hasNewsletterSignup()) return null;
    return React.createElement('footer', { className: 'tt-newsletter-footer' },
      React.createElement('div', { className: 'tt-newsletter-inner' },
        React.createElement('h3', { className: 'tt-newsletter-title' }, 'Stay in the Loop'),
        React.createElement('p', { className: 'tt-newsletter-subtitle' }, 'Get weekly updates on the latest political bullshit.'),
        React.createElement(NewsletterForm, { signupPage: 'eos', signupSource: 'footer' })
      )
    );
  }

  function InlineNewsletterCTA({ signupPage }) {
    const [show, setShow] = useState(false);
    useEffect(() => {
      if (window.TTShared?.hasNewsletterSignup() || window.TTShared?.isInlineCTADismissed()) return;
      let hasTriggered = false;
      const checkScroll = () => {
        if (hasTriggered) return;
        const scrollTop = window.scrollY;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const scrollPercent = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
        if (scrollPercent >= 50) {
          hasTriggered = true;
          setShow(true);
          window.removeEventListener('scroll', checkScroll);
        }
      };
      window.addEventListener('scroll', checkScroll, { passive: true });
      return () => window.removeEventListener('scroll', checkScroll);
    }, []);
    const handleDismiss = () => { setShow(false); window.TTShared?.dismissInlineCTA(); };
    if (!show) return null;
    return React.createElement('div', { className: 'tt-newsletter-inline-wrapper' },
      React.createElement('div', { className: 'tt-newsletter-inline' },
        React.createElement('button', { className: 'tt-newsletter-close', onClick: handleDismiss, 'aria-label': 'Dismiss' }, '×'),
        React.createElement('h3', { className: 'tt-newsletter-title' }, 'Like what you\'re reading?'),
        React.createElement('p', { className: 'tt-newsletter-subtitle' }, 'Get the weekly roundup of political corruption delivered to your inbox.'),
        React.createElement(NewsletterForm, { signupPage, signupSource: 'inline_50pct', isInline: true })
      )
    );
  }

  // ===========================================
  // MAIN APP
  // ===========================================

  function EOPreviewApp() {
    const { theme, toggleTheme } = useTheme();

    // Initialize scroll depth tracking
    useEffect(() => {
      if (window.TTShared?.initScrollDepthTracking) {
        window.TTShared.initScrollDepthTracking('eos');
      }
    }, []);

    return React.createElement('div', { className: 'tt-preview-root', style: { display: 'flex', flexDirection: 'column', minHeight: '100vh' } },
      React.createElement(Header, { theme, toggleTheme }),
      React.createElement(TabNavigation, { activeTab: 'eo' }),
      React.createElement('div', { style: { flex: 1 } },
        React.createElement(EOFeed),
        React.createElement(InlineNewsletterCTA, { signupPage: 'eos' })
      ),
      React.createElement(NewsletterFooter)
    );
  }

  // Mount
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(React.createElement(EOPreviewApp));

})();
