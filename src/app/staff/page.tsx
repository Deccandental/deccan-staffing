if (loading) {
    return (
      <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
        <Sidebar />
        <div className="lg:ml-64 pt-16 lg:pt-0 flex items-center justify-center min-h-screen">
          <p className="text-gray-400">Loading staff...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen" style={{ background: "#f5f5f5" }}>
      <Sidebar />
      <div className="pt-16 lg:pt-0 lg:ml-64 p-4 lg:p-8">
