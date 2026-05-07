import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Device } from 'mediasoup-client';
import io from 'socket.io-client';

const VideoCall = () => {
    const { roomId } = useParams();
    const [roomData, setRoomData] = useState(null);
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [error, setError] = useState(null);
    const [passcodeInput, setPasscodeInput] = useState("");
    const [username, setUsername] = useState("");
    const [isNameSet, setIsNameSet] = useState(false);

    const localVideoRef = useRef();
    const socketRef = useRef();
    const deviceRef = useRef();
    const sendTransportRef = useRef();
    const recvTransportRef = useRef();
    const [remoteStreams, setRemoteStreams] = useState([]);

    useEffect(() => {
        fetch(`https://dev.adenali.com/api/rooms/${roomId}`)
            .then(res => {
                if (!res.ok) throw new Error("Room not found");
                return res.json();
            })
            .then(data => {
                setRoomData(data);
                if (data.status === 'STARTED' && !data.isSecure) {
                    setIsAuthorized(true);
                }
            })
            .catch(err => setError(err.message));
    }, [roomId]);

    useEffect(() => {
        if (!isAuthorized || !isNameSet || !roomData) return;

        socketRef.current = io(roomData.mediaNodeUrl);

        socketRef.current.on('connect', () => {
            socketRef.current.emit('joinRoom', { roomId, username }, async ({ rtpCapabilities, existingProducers }) => {
                const device = new Device();
                await device.load({ routerRtpCapabilities: rtpCapabilities });
                deviceRef.current = device;

                await createSendTransport();
                await createRecvTransport();

                if (existingProducers) {
                    existingProducers.forEach(p => consumeStream(p.id, p.username));
                }
            });
        });

        socketRef.current.on('newProducer', ({ producerId, username }) => {
            consumeStream(producerId, username);
        });

        // LISTENER 1: Remove video when server says a producer is closed
        socketRef.current.on('producerClosed', ({ producerId }) => {
            setRemoteStreams((prev) => prev.filter(s => s.id !== producerId));
        });

        return () => socketRef.current.disconnect();
    }, [isAuthorized, isNameSet, roomData]);

    const handleVerifyPasscode = async () => {
        const res = await fetch(`https://dev.adenali.com/api/rooms/${roomId}/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passcode: passcodeInput })
        });
        if (res.ok) setIsAuthorized(true);
        else alert("Incorrect passcode!");
    };

    const createSendTransport = () => {
        return new Promise((resolve) => {
            socketRef.current.emit('createWebRtcTransport', { sender: true }, async ({ params }) => {
                const transport = deviceRef.current.createSendTransport(params);
                sendTransportRef.current = transport;
                transport.on('connect', ({ dtlsParameters }, callback) => {
                    socketRef.current.emit('connectTransport', { transportId: transport.id, dtlsParameters }, callback);
                });
                transport.on('produce', async ({ kind, rtpParameters }, callback) => {
                    socketRef.current.emit('produce', { transportId: transport.id, kind, rtpParameters }, ({ id }) => callback({ id }));
                });

                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                localVideoRef.current.srcObject = stream;
                await transport.produce({ track: stream.getVideoTracks()[0] });
                await transport.produce({ track: stream.getAudioTracks()[0] });
                resolve();
            });
        });
    };

    const createRecvTransport = () => {
        return new Promise((resolve) => {
            socketRef.current.emit('createWebRtcTransport', { sender: false }, async ({ params }) => {
                const transport = deviceRef.current.createRecvTransport(params);
                recvTransportRef.current = transport;
                transport.on('connect', ({ dtlsParameters }, callback) => {
                    socketRef.current.emit('connectTransport', { transportId: transport.id, dtlsParameters }, callback);
                });
                resolve();
            });
        });
    };

    const consumeStream = async (remoteProducerId, remoteUsername) => {
        const { rtpCapabilities } = deviceRef.current;
        if (!recvTransportRef.current) return;

        socketRef.current.emit('consume', { rtpCapabilities, remoteProducerId, transportId: recvTransportRef.current.id }, async ({ params }) => {
            const consumer = await recvTransportRef.current.consume(params);
            
            // LISTENER 2: If the media-level producer closes, remove the stream immediately
            consumer.on('producerclose', () => {
                setRemoteStreams((prev) => prev.filter(s => s.id !== remoteProducerId));
            });

            socketRef.current.emit('consumerResume', { consumerId: consumer.id });
            const newStream = new MediaStream([consumer.track]);
            
            setRemoteStreams((prev) => {
                if (prev.find(s => s.id === remoteProducerId)) return prev;
                return [...prev, { id: remoteProducerId, stream: newStream, username: remoteUsername }];
            });
        });
    };

    if (error) return <div className="state-screen">Error: {error}</div>;
    if (!roomData) return <div className="state-screen">Loading Room...</div>;

    if (roomData.status === "EARLY") {
        return (
            <div className="state-screen">
                <h2>Too Early!</h2>
                <p>Meeting starts at: {new Date(roomData.startDate).toLocaleString()}</p>
            </div>
        );
    }

    if (roomData.status === "EXPIRED") {
        return <div className="state-screen"><h2>Meeting Ended</h2><p>This room has expired.</p></div>;
    }

    if (roomData.isSecure && !isAuthorized) {
        return (
            <div className="state-screen">
                <h3>Enter Passcode</h3>
                <input type="password" value={passcodeInput} onChange={e => setPasscodeInput(e.target.value)} />
                <button onClick={handleVerifyPasscode}>Verify</button>
            </div>
        );
    }

    if (!isNameSet) {
        return (
            <div className="state-screen">
                <h3>Enter Your Name</h3>
                <input type="text" placeholder="e.g. Aden" value={username} onChange={e => setUsername(e.target.value)} />
                <button onClick={() => setIsNameSet(true)} disabled={!username}>Join Meeting</button>
            </div>
        );
    }

    return (
        <div style={{ backgroundColor: '#111', color: 'white', minHeight: '100vh', padding: '20px' }}>
            <h1>Room: {roomData.roomName}</h1>
            <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', 
                gap: '20px' 
            }}>
                <div style={{ position: 'relative' }}>
                    <h3 style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(0,0,0,0.5)', padding: '5px', borderRadius: '4px', fontSize: '14px' }}>
                        You ({username})
                    </h3>
                    <video ref={localVideoRef} autoPlay muted playsInline style={{ width: '100%', borderRadius: '12px', border: '2px solid #444' }} />
                </div>
                {remoteStreams.map(({ id, stream, username: remoteUser }) => (
                    <div key={id} style={{ position: 'relative' }}>
                        <h3 style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(0,0,0,0.5)', padding: '5px', borderRadius: '4px', fontSize: '14px' }}>
                            {remoteUser}
                        </h3>
                        <VideoComponent stream={stream} />
                    </div>
                ))}
            </div>
        </div>
    );
};

const VideoComponent = ({ stream }) => {
    const ref = useRef();
    useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
    return <video ref={ref} autoPlay playsInline style={{ width: '100%', borderRadius: '12px', border: '2px solid #333' }} />;
};

export default VideoCall;
