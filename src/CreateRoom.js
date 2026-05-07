import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const CreateRoom = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    roomName: '',
    isSecure: false,
    passcode: '',
    startDate: new Date().toISOString().slice(0, 16), // Default to now
    durationHours: 24
  });

  const handleCreate = async (e) => {
    e.preventDefault();
    const response = await fetch('https://dev.adenali.com/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });

    const { roomId } = await response.json();
    // Move user directly to the new room link
    navigate(`/room/${roomId}`);
  };

  return (
    <div style={{ maxWidth: '400px', margin: 'auto', padding: '50px', color: 'white' }}>
      <h2>Create a New Meeting</h2>
      <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <input type="text" placeholder="Room Name" required 
          onChange={e => setFormData({...formData, roomName: e.target.value})} />
        
        <label>
          <input type="checkbox" onChange={e => setFormData({...formData, isSecure: e.target.checked})} />
          Secure with Passcode
        </label>

        {formData.isSecure && (
          <input type="password" placeholder="Set Passcode" required
            onChange={e => setFormData({...formData, passcode: e.target.value})} />
        )}

        <label>Start Date & Time:</label>
        <input type="datetime-local" value={formData.startDate}
          onChange={e => setFormData({...formData, startDate: e.target.value})} />

        <button type="submit" style={{ padding: '10px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '5px' }}>
          Generate Room Link
        </button>
      </form>
    </div>
  );
};
export default CreateRoom;