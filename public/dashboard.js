<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Political Tracker - Admin</title>
    <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <style>
        /* Clean, modern styling */
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { 
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            color: #e2e8f0; 
            min-height: 100vh; 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        
        .bg-card { background-color: rgba(15, 23, 42, 0.8); backdrop-filter: blur(10px); }
        .bg-surface { background-color: rgba(30, 41, 59, 0.6); }
        .border-subtle { border-color: rgba(148, 163, 184, 0.2); }
        .text-primary { color: #3b82f6; }
        .text-muted { color: #94a3b8; }
        .text-success { color: #10b981; }
        .text-warning { color: #f59e0b; }
        .text-error { color: #ef4444; }
        
        /* Severity indicators - subtle and clean */
        .severity-high { 
            background: rgba(239, 68, 68, 0.1); 
            color: #fca5a5; 
            border: 1px solid rgba(239, 68, 68, 0.2);
        }
        .severity-medium { 
            background: rgba(245, 158, 11, 0.1); 
            color: #fbbf24; 
            border: 1px solid rgba(245, 158, 11, 0.2);
        }
        .severity-low { 
            background: rgba(16, 185, 129, 0.1); 
            color: #6ee7b7; 
            border: 1px solid rgba(16, 185, 129, 0.2);
        }
        
        /* Clean buttons */
        .btn-primary {
            background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
            border: none;
            color: white;
            transition: all 0.2s ease;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
        }
        .btn-primary:hover { 
            transform: translateY(-1px); 
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3); 
        }
        
        .btn-secondary {
            background: rgba(100, 116, 139, 0.1);
            border: 1px solid rgba(148, 163, 184, 0.2);
            color: #e2e8f0;
            transition: all 0.2s ease;
        }
        .btn-secondary:hover { 
            background: rgba(100, 116, 139, 0.2); 
            border-color: rgba(148, 163, 184, 0.3);
        }
        
        .btn-success {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            border: none;
            color: white;
        }
        .btn-success:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
        }
        
        .btn-warning {
            background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
            border: none;
            color: white;
        }
        .btn-warning:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
        }
        
        .btn-danger {
            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
            border: none;
            color: white;
        }
        .btn-danger:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
        }
        
        /* Form inputs */
        input, select, textarea { 
            background: rgba(30, 41, 59, 0.6); 
            border: 1px solid rgba(148, 163, 184, 0.2); 
            color: #e2e8f0;
            transition: all 0.2s ease;
        }
        input:focus, select:focus, textarea:focus { 
            border-color: #3b82f6; 
            outline: none; 
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        
        /* Layout utilities */
        .rounded { border-radius: 0.5rem; }
        .rounded-lg { border-radius: 0.75rem; }
        .p-4 { padding: 1rem; }
        .p-6 { padding: 1.5rem; }
        .px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
        .px-4 { padding-left: 1rem; padding-right: 1rem; }
        .py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
        .py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem; }
        .mt-4 { margin-top: 1rem; }
        .mb-2 { margin-bottom: 0.5rem; }
        .mb-4 { margin-bottom: 1rem; }
        .ml-3 { margin-left: 0.75rem; }
        .w-full { width: 100%; }
        .h-full { height: 100%; }
        .max-w-7xl { max-width: 80rem; }
        .mx-auto { margin-left: auto; margin-right: auto; }
        .flex { display: flex; }
        .flex-col { flex-direction: column; }
        .flex-1 { flex: 1 1 0%; }
        .items-center { align-items: center; }
        .justify-between { justify-content: space-between; }
        .gap-3 { gap: 0.75rem; }
        .gap-4 { gap: 1rem; }
        .space-y-3 > * + * { margin-top: 0.75rem; }
        .text-sm { font-size: 0.875rem; }
        .text-lg { font-size: 1.125rem; }
        .text-2xl { font-size: 1.5rem; }
        .font-medium { font-weight: 500; }
        .font-semibold { font-weight: 600; }
        .font-bold { font-weight: 700; }
        .border { border-width: 1px; }
        .cursor-pointer { cursor: pointer; }
        .transition-all { transition: all 0.2s ease; }
        .overflow-y-auto { overflow-y: auto; }
        .min-h-screen { min-height: 100vh; }
        button { cursor: pointer; border-radius: 0.5rem; padding: 0.5rem 1rem; transition: all 0.2s ease; }
        button:disabled { opacity: 0.5; cursor: not-allowed; transform: none !important; }
        
        /* Full height layout */
        .admin-container { height: 100vh; display: flex; flex-direction: column; }
        .entries-area { flex: 1; overflow-y: auto; min-height: 0; }
        
        /* Entry cards - clean and minimal */
        .entry-card {
            background: rgba(30, 41, 59, 0.4);
            border: 1px solid rgba(148, 163, 184, 0.1);
            transition: all 0.2s ease;
        }
        .entry-card:hover {
            background: rgba(30, 41, 59, 0.6);
            border-color: rgba(148, 163, 184, 0.2);
            transform: translateY(-1px);
        }
        .entry-card.selected {
            background: rgba(59, 130, 246, 0.1);
            border-color: rgba(59, 130, 246, 0.3);
        }
        .entry-card.archived {
            background: rgba(100, 116, 139, 0.1);
            border-color: rgba(100, 116, 139, 0.2);
        }
    </style>
</head>
<body>
    <div id="admin-root"></div>

    <script type="text/babel">
        const { useState, useEffect } = React;
        
        function b64FromUtf8(str) {
            const bytes = new TextEncoder().encode(str);
            let binary = '';
            for (let b of bytes) binary += String.fromCharCode(b);
            return btoa(binary);
        }

        function SecureAdminInterface() {
            const [isAuthenticated, setIsAuthenticated] = useState(false);
            const [githubToken, setGithubToken] = useState('');
            const [entries, setEntries] = useState([]);
            const [selectedEntries, setSelectedEntries] = useState(new Set());
            const [searchTerm, setSearchTerm] = useState('');
            const [isLoading, setIsLoading] = useState(false);
            const [message, setMessage] = useState('');
            const [showArchived, setShowArchived] = useState(false);
            const [editingEntry, setEditingEntry] = useState(null);
            const [editForm, setEditForm] = useState({});

            const showMessage = (text, type = 'info') => {
                setMessage({ text, type });
                setTimeout(() => setMessage(''), 4000);
            };

            const authenticate = () => {
                if (githubToken.trim()) {
                    if (githubToken.startsWith('github_pat_') || githubToken.startsWith('ghp_')) {
                        setIsAuthenticated(true);
                        sessionStorage.setItem('github_token', githubToken);
                        loadEntries();
                        showMessage('Authentication successful!', 'success');
                    } else {
                        showMessage('Invalid GitHub token format', 'error');
                    }
                } else {
                    showMessage('Please enter your GitHub token', 'error');
                }
            };

            useEffect(() => {
                const sessionToken = sessionStorage.getItem('github_token');
                if (sessionToken) {
                    setGithubToken(sessionToken);
                }
            }, []);

            const loadEntries = async () => {
                try {
                    setIsLoading(true);
                    const response = await fetch('/master-tracker-log.json');
                    if (response.ok) {
                        const data = await response.json();
                        setEntries(data || []);
                        showMessage(`Loaded ${data?.length || 0} entries`, 'success');
                    } else {
                        showMessage('Failed to load entries', 'error');
                    }
                } catch (error) {
                    showMessage(`Error loading entries: ${error.message}`, 'error');
                } finally {
                    setIsLoading(false);
                }
            };

            const updateGitHubFile = async (newData) => {
                try {
                    const repo = 'AJWolfe18/TTracker';
                    const path = 'master-tracker-log.json';
                    
                    const getResponse = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=main`, {
                        headers: {
                            'Authorization': `Bearer ${githubToken}`,
                            'Accept': 'application/vnd.github.v3+json'
                        }
                    });

                    if (!getResponse.ok) {
                        throw new Error(`Failed to get file info: ${getResponse.status}`);
                    }

                    const fileInfo = await getResponse.json();
                    const content = b64FromUtf8(JSON.stringify(newData, null, 2));

                    const updateResponse = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
                        method: 'PUT',
                        headers: {
                            'Authorization': `Bearer ${githubToken}`,
                            'Accept': 'application/vnd.github.v3+json',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            message: 'Admin: Update tracker data',
                            content: content,
                            sha: fileInfo.sha,
                            branch: 'main'
                        })
                    });

                    if (!updateResponse.ok) {
                        throw new Error(`Failed to update file: ${updateResponse.status}`);
                    }

                    // Update public folder
                    try {
                        const publicGetResponse = await fetch(`https://api.github.com/repos/${repo}/contents/public/${path}?ref=main`, {
                            headers: {
                                'Authorization': `Bearer ${githubToken}`,
                                'Accept': 'application/vnd.github.v3+json'
                            }
                        });

                        if (publicGetResponse.ok) {
                            const publicFileInfo = await publicGetResponse.json();
                            await fetch(`https://api.github.com/repos/${repo}/contents/public/${path}`, {
                                method: 'PUT',
                                headers: {
                                    'Authorization': `Bearer ${githubToken}`,
                                    'Accept': 'application/vnd.github.v3+json',
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    message: 'Admin: Update public tracker data',
                                    content: content,
                                    sha: publicFileInfo.sha,
                                    branch: 'main'
                                })
                            });
                        }
                    } catch (error) {
                        console.warn('Could not update public folder:', error);
                    }

                    return true;
                } catch (error) {
                    console.error('GitHub update error:', error);
                    throw error;
                }
            };

            const archiveSelected = async () => {
                if (selectedEntries.size === 0) {
                    showMessage('No entries selected for archiving', 'error');
                    return;
                }

                if (!confirm(`Archive ${selectedEntries.size} selected entries?`)) {
                    return;
                }

                try {
                    setIsLoading(true);
                    const updatedEntries = entries.map(entry => {
                        if (selectedEntries.has(entry.id)) {
                            return { ...entry, archived: true, archived_at: new Date().toISOString() };
                        }
                        return entry;
                    });
                    
                    await updateGitHubFile(updatedEntries);
                    setEntries(updatedEntries);
                    setSelectedEntries(new Set());
                    showMessage(`Successfully archived ${selectedEntries.size} entries`, 'success');
                } catch (error) {
                    showMessage(`Error archiving entries: ${error.message}`, 'error');
                } finally {
                    setIsLoading(false);
                }
            };

            const restoreSelected = async () => {
                if (selectedEntries.size === 0) {
                    showMessage('No entries selected for restoration', 'error');
                    return;
                }

                try {
                    setIsLoading(true);
                    const updatedEntries = entries.map(entry => {
                        if (selectedEntries.has(entry.id)) {
                            const { archived, archived_at, ...restoredEntry } = entry;
                            return restoredEntry;
                        }
                        return entry;
                    });
                    
                    await updateGitHubFile(updatedEntries);
                    setEntries(updatedEntries);
                    setSelectedEntries(new Set());
                    showMessage(`Successfully restored ${selectedEntries.size} entries`, 'success');
                } catch (error) {
                    showMessage(`Error restoring entries: ${error.message}`, 'error');
                } finally {
                    setIsLoading(false);
                }
            };

            const deleteSelected = async () => {
                if (selectedEntries.size === 0) {
                    showMessage('No entries selected for deletion', 'error');
                    return;
                }

                if (!confirm(`Permanently delete ${selectedEntries.size} selected entries? This cannot be undone.`)) {
                    return;
                }

                try {
                    setIsLoading(true);
                    const updatedEntries = entries.filter(entry => !selectedEntries.has(entry.id));
                    
                    await updateGitHubFile(updatedEntries);
                    setEntries(updatedEntries);
                    setSelectedEntries(new Set());
                    showMessage(`Successfully deleted ${selectedEntries.size} entries`, 'success');
                } catch (error) {
                    showMessage(`Error deleting entries: ${error.message}`, 'error');
                } finally {
                    setIsLoading(false);
                }
            };

            const startEdit = (entry) => {
                setEditingEntry(entry.id);
                setEditForm({
                    title: entry.title,
                    description: entry.description,
                    actor: entry.actor,
                    category: entry.category,
                    severity: entry.severity,
                    source_url: entry.source_url,
                    verified: entry.verified,
                    date: entry.date
                });
            };

            const saveEdit = async () => {
                try {
                    setIsLoading(true);
                    const updatedEntries = entries.map(entry => {
                        if (entry.id === editingEntry) {
                            return { ...entry, ...editForm, modified_at: new Date().toISOString() };
                        }
                        return entry;
                    });
                    
                    await updateGitHubFile(updatedEntries);
                    setEntries(updatedEntries);
                    setEditingEntry(null);
                    setEditForm({});
                    showMessage('Entry updated successfully', 'success');
                } catch (error) {
                    showMessage(`Error updating entry: ${error.message}`, 'error');
                } finally {
                    setIsLoading(false);
                }
            };

            const toggleSelection = (entryId) => {
                const newSelected = new Set(selectedEntries);
                if (newSelected.has(entryId)) {
                    newSelected.delete(entryId);
                } else {
                    newSelected.add(entryId);
                }
                setSelectedEntries(newSelected);
            };

            const selectAll = () => {
                if (selectedEntries.size === filteredEntries.length) {
                    setSelectedEntries(new Set());
                } else {
                    setSelectedEntries(new Set(filteredEntries.map(e => e.id)));
                }
            };

            const logout = () => {
                setIsAuthenticated(false);
                setGithubToken('');
                sessionStorage.removeItem('github_token');
                setEntries([]);
                setSelectedEntries(new Set());
            };

            const filteredEntries = entries.filter(entry => {
                if (showArchived && !entry.archived) return false;
                if (!showArchived && entry.archived) return false;
                
                return !searchTerm || 
                    Object.values(entry).some(value => 
                        value?.toString().toLowerCase().includes(searchTerm.toLowerCase())
                    );
            });

            if (!isAuthenticated) {
                return (
                    <div className="min-h-screen flex items-center justify-center p-6">
                        <div className="bg-card border border-subtle rounded-lg p-8 max-w-md w-full">
                            <div className="text-center mb-6">
                                <h1 className="text-2xl font-bold text-primary mb-2">Admin Access</h1>
                                <p className="text-muted">Enter your GitHub token to continue</p>
                            </div>
                            
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium mb-2">GitHub Personal Access Token</label>
                                    <input
                                        type="password"
                                        value={githubToken}
                                        onChange={(e) => setGithubToken(e.target.value)}
                                        onKeyPress={(e) => e.key === 'Enter' && authenticate()}
                                        className="w-full px-3 py-2 rounded"
                                        placeholder="github_pat_... or ghp_..."
                                        autoFocus
                                    />
                                    <p className="text-sm text-muted mt-1">
                                        Requires "Contents: Write" permission for TTracker repository
                                    </p>
                                </div>
                                
                                <button onClick={authenticate} className="w-full btn-primary py-3 font-medium">
                                    Authenticate
                                </button>
                                
                                {message && (
                                    <div className={`p-3 rounded text-sm ${
                                        message.type === 'error' ? 'bg-red-900/20 text-error border border-red-900/30' :
                                        message.type === 'success' ? 'bg-green-900/20 text-success border border-green-900/30' :
                                        'bg-blue-900/20 text-primary border border-blue-900/30'
                                    }`}>
                                        {message.text}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            }

            return (
                <div className="admin-container">
                    <div className="max-w-7xl mx-auto flex flex-col h-full">
                        {/* Header */}
                        <div className="bg-card border-b border-subtle p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h1 className="text-2xl font-bold text-primary">Political Tracker Admin</h1>
                                <button onClick={logout} className="btn-secondary px-4 py-2">
                                    Logout
                                </button>
                            </div>
                            
                            {/* Search and Controls */}
                            <div className="flex items-center gap-4 mb-4">
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="Search entries..."
                                    className="flex-1 px-3 py-2 rounded"
                                />
                                <button
                                    onClick={loadEntries}
                                    disabled={isLoading}
                                    className="btn-secondary px-4 py-2"
                                >
                                    {isLoading ? 'Loading...' : 'Refresh'}
                                </button>
                            </div>
                            
                            {/* Action Bar */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <span className="text-sm text-muted">
                                        {filteredEntries.length} entries • {selectedEntries.size} selected
                                    </span>
                                    <button
                                        onClick={() => setShowArchived(!showArchived)}
                                        className={`btn-secondary px-3 py-2 text-sm ${showArchived ? 'bg-purple-900/20 text-purple-300' : ''}`}
                                    >
                                        {showArchived ? 'Show Active' : 'Show Archived'}
                                    </button>
                                    <button onClick={selectAll} className="btn-secondary px-3 py-2 text-sm">
                                        {selectedEntries.size === filteredEntries.length ? 'Deselect All' : 'Select All'}
                                    </button>
                                </div>
                                
                                <div className="flex gap-2">
                                    {!showArchived ? (
                                        <button
                                            onClick={archiveSelected}
                                            disabled={selectedEntries.size === 0 || isLoading}
                                            className="btn-warning px-4 py-2 text-sm"
                                        >
                                            Archive ({selectedEntries.size})
                                        </button>
                                    ) : (
                                        <button
                                            onClick={restoreSelected}
                                            disabled={selectedEntries.size === 0 || isLoading}
                                            className="btn-success px-4 py-2 text-sm"
                                        >
                                            Restore ({selectedEntries.size})
                                        </button>
                                    )}
                                    <button
                                        onClick={deleteSelected}
                                        disabled={selectedEntries.size === 0 || isLoading}
                                        className="btn-danger px-4 py-2 text-sm"
                                    >
                                        Delete ({selectedEntries.size})
                                    </button>
                                </div>
                            </div>
                        </div>
                        
                        {/* Message */}
                        {message && (
                            <div className={`mx-6 mt-4 p-3 rounded text-sm ${
                                message.type === 'error' ? 'bg-red-900/20 text-error border border-red-900/30' :
                                message.type === 'success' ? 'bg-green-900/20 text-success border border-green-900/30' :
                                'bg-blue-900/20 text-primary border border-blue-900/30'
                            }`}>
                                {message.text}
                            </div>
                        )}
                        
                        {/* Entries */}
                        <div className="entries-area p-6">
                            {filteredEntries.length === 0 ? (
                                <div className="text-center py-12">
                                    <p className="text-muted">No entries found</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {filteredEntries.map((entry) => (
                                        <div
                                            key={entry.id}
                                            className={`entry-card rounded-lg p-4 cursor-pointer ${
                                                editingEntry === entry.id ? 'bg-blue-900/20 border-blue-400' :
                                                selectedEntries.has(entry.id) ? 'selected' :
                                                entry.archived ? 'archived' : ''
                                            }`}
                                            onClick={() => editingEntry !== entry.id && toggleSelection(entry.id)}
                                        >
                                            {editingEntry === entry.id ? (
                                                <div className="space-y-3">
                                                    {/* Edit form - clean and minimal */}
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <div>
                                                            <label className="block text-sm text-muted mb-1">Date</label>
                                                            <input
                                                                type="date"
                                                                value={editForm.date}
                                                                onChange={(e) => setEditForm({...editForm, date: e.target.value})}
                                                                className="w-full px-3 py-2 rounded text-sm"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-sm text-muted mb-1">Severity</label>
                                                            <select
                                                                value={editForm.severity}
                                                                onChange={(e) => setEditForm({...editForm, severity: e.target.value})}
                                                                className="w-full px-3 py-2 rounded text-sm"
                                                            >
                                                                <option value="low">Low</option>
                                                                <option value="medium">Medium</option>
                                                                <option value="high">High</option>
                                                            </select>
                                                        </div>
                                                    </div>
                                                    
                                                    <div>
                                                        <label className="block text-sm text-muted mb-1">Actor</label>
                                                        <input
                                                            type="text"
                                                            value={editForm.actor}
                                                            onChange={(e) => setEditForm({...editForm, actor: e.target.value})}
                                                            className="w-full px-3 py-2 rounded text-sm"
                                                        />
                                                    </div>
                                                    
                                                    <div>
                                                        <label className="block text-sm text-muted mb-1">Title</label>
                                                        <input
                                                            type="text"
                                                            value={editForm.title}
                                                            onChange={(e) => setEditForm({...editForm, title: e.target.value})}
                                                            className="w-full px-3 py-2 rounded text-sm"
                                                        />
                                                    </div>
                                                    
                                                    <div>
                                                        <label className="block text-sm text-muted mb-1">Description</label>
                                                        <textarea
                                                            value={editForm.description}
                                                            onChange={(e) => setEditForm({...editForm, description: e.target.value})}
                                                            className="w-full px-3 py-2 rounded text-sm"
                                                            rows="3"
                                                        />
                                                    </div>
                                                    
                                                    <div className="flex gap-3">
                                                        <button onClick={saveEdit} className="btn-success px-4 py-2 text-sm">
                                                            Save Changes
                                                        </button>
                                                        <button 
                                                            onClick={() => setEditingEntry(null)} 
                                                            className="btn-secondary px-4 py-2 text-sm"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex items-start justify-between">
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-3 mb-2">
                                                            <span className="text-sm text-muted">{entry.date}</span>
                                                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                                                                entry.severity === 'high' ? 'severity-high' :
                                                                entry.severity === 'medium' ? 'severity-medium' :
                                                                'severity-low'
                                                            }`}>
                                                                {entry.severity}
                                                            </span>
                                                            {entry.archived && (
                                                                <span className="px-2 py-1 bg-purple-900/20 text-purple-300 rounded text-xs border border-purple-900/30">
                                                                    Archived
                                                                </span>
                                                            )}
                                                            <span className="text-sm text-primary">{entry.actor}</span>
                                                        </div>
                                                        
                                                        <h3 className="font-semibold mb-2 text-lg">{entry.title}</h3>
                                                        <p className="text-muted text-sm mb-3 leading-relaxed">{entry.description}</p>
                                                        
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-xs text-muted">{entry.category}</span>
                                                            <div className="flex items-center gap-2">
                                                                {entry.verified && (
                                                                    <span className="text-success text-xs">✓ Verified</span>
                                                                )}
                                                                {entry.modified_at && (
                                                                    <span className="text-xs text-muted">
                                                                        Modified: {new Date(entry.modified_at).toLocaleDateString()}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    
                                                    <div className="ml-4 flex items-center gap-3">
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                startEdit(entry);
                                                            }}
                                                            className="btn-secondary px-3 py-1 text-xs"
                                                        >
                                                            Edit
                                                        </button>
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedEntries.has(entry.id)}
                                                            onChange={() => toggleSelection(entry.id)}
                                                            onClick={(e) => e.stopPropagation()}
                                                            className="w-4 h-4 accent-blue-500"
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            );
        }

        ReactDOM.render(<SecureAdminInterface />, document.getElementById('admin-root'));
    </script>
</body>
</html>
