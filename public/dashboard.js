                            )}
                        </div>

                        {/* Pagination Controls */}
                        {totalPages > 1 && (
                            <div className="flex justify-center items-center gap-2 mt-6">
                                <button
                                    onClick={() => setPage(Math.max(1, page - 1))}
                                    disabled={page === 1}
                                    className="px-3 py-1 bg-gray-800 border border-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-700"
                                >
                                    Previous
                                </button>
                                
                                <span className="px-3 py-1 text-gray-400">
                                    Page {page} of {totalPages}
                                </span>
                                
                                <button
                                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                                    disabled={page === totalPages}
                                    className="px-3 py-1 bg-gray-800 border border-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-700"
                                >
                                    Next
                                </button>
                            </div>
                        )}
                    </>
                ) : (
                    /* Executive Orders Tab */
                    <div className="grid gap-4">
                        {filteredExecutiveOrders.length === 0 ? (
                            <div className="text-center py-12">
                                <p className="text-gray-400 text-lg">No executive orders found</p>
                            </div>
                        ) : (
                            filteredExecutiveOrders.map(order => (
                                <div key={order.id} className="bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-gray-600 transition-colors">
                                    <div className="flex items-start justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-gray-500">{order.date}</span>
                                            {order.order_number && (
                                                <span className="px-2 py-1 text-xs bg-blue-900 text-blue-200 rounded">
                                                    EO {order.order_number}
                                                </span>
                                            )}
                                            {order.impact_score && order.impact_score >= 70 && (
                                                <span className="px-2 py-1 text-xs bg-red-900 text-red-200 rounded">
                                                    High Impact
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    
                                    <h3 className="text-lg font-semibold text-white mb-2">{order.title}</h3>
                                    
                                    {order.summary && (
                                        <p className="text-gray-400 mb-3">{order.summary}</p>
                                    )}
                                    
                                    <div className="flex flex-wrap gap-2 mb-3">
                                        {order.agencies_affected && order.agencies_affected.length > 0 && (
                                            <div className="text-sm text-gray-500">
                                                Affects: {order.agencies_affected.slice(0, 3).join(', ')}
                                                {order.agencies_affected.length > 3 && ` +${order.agencies_affected.length - 3} more`}
                                            </div>
                                        )}
                                    </div>
                                    
                                    <div className="flex items-center gap-4 text-sm">
                                        {order.source_url && (
                                            <a 
                                                href={order.source_url} 
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                className="text-blue-400 hover:text-blue-300"
                                            >
                                                Federal Register →
                                            </a>
                                        )}
                                        {order.pdf_url && (
                                            <a 
                                                href={order.pdf_url} 
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                className="text-green-400 hover:text-green-300"
                                            >
                                                PDF →
                                            </a>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>

            {/* Footer */}
            <footer className="bg-gray-800 border-t border-gray-700 mt-12">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                    <div className="text-center text-sm text-gray-400">
                        <p>Data powered by Supabase • Updates daily at 9 AM EST</p>
                        <p className="mt-1">Tracking {statistics.totalEntries} political events and {statistics.totalExecutiveOrders} executive orders</p>
                    </div>
                </div>
            </footer>
        </div>
    );
}

// Mount the app
ReactDOM.render(<PoliticalDashboard />, document.getElementById('root'));