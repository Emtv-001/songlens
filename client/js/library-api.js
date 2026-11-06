const LibraryAPI = {
  async isLoggedIn() {
    try {
      const response = await fetch('/api/v1/auth/me');
      return response.ok;
    } catch (err) {
      return false;
    }
  },

  async getItems() {
    const response = await fetch('/api/v1/users/me/library');
    if (!response.ok) throw new Error('Could not load library');
    const data = await response.json();
    return data.items;
  },

  save(songId) {
    return fetch(`/api/v1/users/me/library/${songId}`, { method: 'POST' });
  },

  remove(songId) {
    return fetch(`/api/v1/users/me/library/${songId}`, { method: 'DELETE' });
  },
};