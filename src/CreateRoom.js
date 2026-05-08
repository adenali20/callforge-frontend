import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const CreateRoom = () => {
  const navigate = useNavigate();
  const [history, setHistory] = useState([]);
  const [formData, setFormData] = useState({
    roomName: '',
    isSecure: false,
    passcode: '',
    startDate: new Date().toISOString().slice(0, 16),
    durationHours: 24
  });

  // Load history from LocalStorage on mount
  useEffect(() => {
    const savedHistory = JSON.parse(localStorage.getItem('roomHistory') || '[]');
    setHistory(savedHistory);
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    // Updated to use your production domain/proxy
    const response = await fetch('https://dev.adenali.com/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });

    const { roomId } = await response.json();
    navigate(`/room/${roomId}`);
  };

  const clearHistory = () => {
    localStorage.removeItem('roomHistory');
    setHistory([]);
  };

  return (
    <div style={{ maxWidth: '500px', margin: 'auto', padding: '50px', color: 'white', fontFamily: 'sans-serif' }}>
      <div style={{ backgroundColor: '#222', padding: '30px', borderRadius: '12px', boxShadow: '0 4px 15px rgba(0,0,0,0.5)' }}>
        <h2>Create a New Meeting</h2>
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <input 
            type="text" 
            placeholder="Room Name" 
            required 
            style={{ padding: '10px', borderRadius: '5px', border: '1px solid #444', backgroundColor: '#333', color: 'white' }}
            onChange={e => setFormData({...formData, roomName: e.target.value})} 
          />
          
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input type="checkbox" onChange={e => setFormData({...formData, isSecure: e.target.checked})} />
            Secure with Passcode
          </label>

          {formData.isSecure && (
            <input 
              type="password" 
              placeholder="Set Passcode" 
              required 
              style={{ padding: '10px', borderRadius: '5px', border: '1px solid #444', backgroundColor: '#333', color: 'white' }}
              onChange={e => setFormData({...formData, passcode: e.target.value})} 
            />
          )}

          <label>Start Date & Time:</label>
          <input 
            type="datetime-local" 
            value={formData.startDate} 
            style={{ padding: '10px', borderRadius: '5px', border: '1px solid #444', backgroundColor: '#333', color: 'white' }}
            onChange={e => setFormData({...formData, startDate: e.target.value})} 
          />

          <button type="submit" style={{ padding: '12px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}>
            Generate Room Link
          </button>
        </form>
      </div>

      {/* --- RECENT ROOMS SECTION --- */}
      {history.length > 0 && (
        <div style={{ marginTop: '40px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Recent Rooms</h3>
            <button onClick={clearHistory} style={{ background: 'none', border: 'none', color: '#ff4444', cursor: 'pointer', fontSize: '12px' }}>
              Clear All
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {history.map(room => (
              <div 
                key={room.id} 
                onClick={() => navigate(`/room/${room.id}`)}
                style={{ 
                  padding: '15px', 
                  backgroundColor: '#222', 
                  borderRadius: '8px', 
                  cursor: 'pointer', 
                  border: '1px solid #333',
                  transition: 'background 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#2a2a2a'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#222'}
              >
                <div style={{ fontWeight: 'bold', color: '#007bff' }}>{room.name || 'Untitled Room'}</div>
                <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
                  ID: {room.id.substring(0, 8)}... • Joined {new Date(room.timestamp).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CreateRoom;
