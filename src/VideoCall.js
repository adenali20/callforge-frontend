import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Device } from 'mediasoup-client';
import io from 'socket.io-client';
import './VideoCall.css';

const VideoCall = () => {
    const { roomId } = useParams();
    const [roomData, setRoomData] = useState(null);
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [error, setError] = useState(null);
    const [passcodeInput, setPasscodeInput] = useState("");
    const [username, setUsername] = useState("");
    const [isNameSet, setIsNameSet] = useState(false);
    
    // Track active speaker by username (or socketId) to highlight the correct box
    const [activeSpeakerName, setActiveSpeakerName] = useState(null);

    const localVideoRef = useRef();
    const socketRef = useRef();
    const deviceRef = useRef();
    const sendTransportRef = useRef();
    const recvTransportRef = useRef();

    // UPDATED: Use an object keyed by username to avoid duplicate frames
    const [peers, setPeers] = useState({}); // { "Aden": { stream: MediaStream, videoId: id, audioId: id } }

    useEffect(() => {
        fetch(`https://dev.adenali.com/api/rooms/${roomId}`)
            .then(res => {
                if (!res.ok) throw new Error("Room not found");
                return res.json();
            })
            .then(data => {
                setRoomData(data);
                if (data.status === 'STARTED' && !data.isSecure) setIsAuthorized(true);
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

        socketRef.current.on('producerClosed', ({ producerId }) => {
            setPeers((prev) => {
                const newPeers = { ...prev };
                // Find which user this producer belonged to and remove them
                for (const name in newPeers) {
                    if (newPeers[name].videoId === producerId || newPeers[name].audioId === producerId) {
                        delete newPeers[name];
                    }
                }
                return newPeers;
            });
        });

        // ACTIVE SPEAKER: Map the producerId back to a username
        socketRef.current.on('activeSpeaker', ({ producerId }) => {
            setPeers(prev => {
                for (const name in prev) {
                    if (prev[name].audioId === producerId || prev[name].videoId === producerId) {
                        setActiveSpeakerName(name);
                        return prev;
                    }
                }
                if (!producerId) setActiveSpeakerName(null);
                return prev;
            });
        });

        return () => socketRef.current.disconnect();
    }, [isAuthorized, isNameSet, roomData]);

    const consumeStream = async (remoteProducerId, remoteUsername) => {
        const { rtpCapabilities } = deviceRef.current;
        if (!recvTransportRef.current) return;

        socketRef.current.emit('consume', { rtpCapabilities, remoteProducerId, transportId: recvTransportRef.current.id }, async ({ params }) => {
            const consumer = await recvTransportRef.current.consume(params);
            
            socketRef.current.emit('consumerResume', { consumerId: consumer.id });

            setPeers((prev) => {
                const existingPeer = prev[remoteUsername] || { 
                    username: remoteUsername, 
                    stream: new MediaStream(),
                    videoId: null,
                    audioId: null 
                };

                // Add the new track to the existing MediaStream for this user
                existingPeer.stream.addTrack(consumer.track);
                
                if (consumer.kind === 'video') existingPeer.videoId = remoteProducerId;
                if (consumer.kind === 'audio') existingPeer.audioId = remoteProducerId;

                return { ...prev, [remoteUsername]: { ...existingPeer } };
            });

            consumer.on('producerclose', () => {
                setPeers(prev => {
                    const newPeers = { ...prev };
                    delete newPeers[remoteUsername];
                    return newPeers;
                });
            });
        });
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

                if (stream.getVideoTracks().length > 0) {
                    await transport.produce({ 
                        track: stream.getVideoTracks()[0],
                        encodings: [
                            { maxBitrate: 100000, scaleResolutionDownBy: 4 },
                            { maxBitrate: 300000, scaleResolutionDownBy: 2 },
                            { maxBitrate: 900000 }
                        ]
                    });
                }
                if (stream.getAudioTracks().length > 0) {
                    await transport.produce({ track: stream.getAudioTracks()[0] });
                }
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

    const handleVerifyPasscode = async () => { /* Same as before */ };

    if (error) return <div className="state-screen">Error: {error}</div>;
    if (!roomData) return <div className="state-screen">Loading Room...</div>;
    // ... (Keep Early, Expired, Secure, and Name Gate logic same as before) ...
    
    if (!isNameSet) {
        return (
            <div className="state-screen">
                <h3>Enter Your Name</h3>
                <input type="text" placeholder="e.g. Aden" value={username} onChange={e => setUsername(e.target.value)} />
                <button onClick={() => setIsNameSet(true)} disabled={!username}>Join Meeting</button>
            </div>
        );
    }

    const peerList = Object.values(peers);
    const gridClass = peerList.length > 12 ? "video-grid high-density" : "video-grid";

    return (
        <div className="room-container">
            <h1 className="room-title">Room: {roomData.roomName}</h1>
            <div className={gridClass}>
                <div className="video-container">
                    <div className="name-tag">You ({username})</div>
                    <video ref={localVideoRef} autoPlay muted playsInline />
                </div>
                {peerList.map((peer) => (
                    <div key={peer.username} className={`video-container ${activeSpeakerName === peer.username ? 'active-speaker' : ''}`}>
                        <div className="name-tag">{peer.username}</div>
                        <VideoComponent stream={peer.stream} />
                    </div>
                ))}
            </div>
        </div>
    );
};

const VideoComponent = ({ stream }) => {
    const ref = useRef();
    useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
    return <video ref={ref} autoPlay playsInline />;
};

export default VideoCall;
