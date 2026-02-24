"""
Streaming support for real-time agent responses.
"""

from typing import AsyncIterator, Iterator, Optional
from langchain_core.messages import HumanMessage, AIMessage
import asyncio


class StreamingAgent:
    """Wrapper for streaming agent responses."""
    
    def __init__(self, agent):
        """
        Initialize streaming agent wrapper.
        
        Args:
            agent: The ConversationalAgent instance to wrap
        """
        self.agent = agent
    
    def stream_response(
        self,
        user_input: str,
        image_paths: Optional[list] = None,
        video_paths: Optional[list] = None
    ) -> Iterator[dict]:
        """
        Stream agent response token-by-token or chunk-by-chunk.
        
        Args:
            user_input: User's input message
            image_paths: Optional list of image paths
            video_paths: Optional list of video paths
        
        Yields:
            Dictionary with response chunks
        """
        # Use agent's existing stream method
        for chunk in self.agent.stream(user_input, image_paths, video_paths):
            # Extract messages from chunk
            if "messages" in chunk:
                for message in chunk["messages"]:
                    if isinstance(message, AIMessage):
                        # Yield content chunks
                        if hasattr(message, 'content'):
                            content = message.content
                            if isinstance(content, str):
                                # Stream character by character for real-time feel
                                for char in content:
                                    yield {
                                        "type": "token",
                                        "content": char,
                                        "complete": False
                                    }
                            yield {
                                "type": "complete",
                                "content": content,
                                "complete": True
                            }
            
            yield {
                "type": "chunk",
                "data": chunk
            }
    
    async def stream_response_async(
        self,
        user_input: str,
        image_paths: Optional[list] = None,
        video_paths: Optional[list] = None
    ) -> AsyncIterator[dict]:
        """
        Async version of stream_response.
        
        Args:
            user_input: User's input message
            image_paths: Optional list of image paths
            video_paths: Optional list of video paths
        
        Yields:
            Dictionary with response chunks
        """
        # Run streaming in executor to avoid blocking
        loop = asyncio.get_event_loop()
        
        def _stream():
            return list(self.stream_response(user_input, image_paths, video_paths))
        
        chunks = await loop.run_in_executor(None, _stream)
        
        for chunk in chunks:
            yield chunk


class StreamingSTT:
    """Streaming Speech-to-Text wrapper."""
    
    def __init__(self, stt_model):
        """
        Initialize streaming STT.
        
        Args:
            stt_model: STT model (e.g., Whisper)
        """
        self.stt_model = stt_model
        self.buffer = []
        self.buffer_size = 5  # Process every N chunks
    
    def transcribe_stream(self, audio_chunk: bytes) -> Iterator[str]:
        """
        Process audio chunks and yield partial transcriptions.
        
        Args:
            audio_chunk: Audio data chunk
        
        Yields:
            Partial transcription text
        """
        import numpy as np
        
        self.buffer.append(audio_chunk)
        
        # Process when buffer is full
        if len(self.buffer) >= self.buffer_size:
            # Concatenate audio chunks
            audio_data = np.concatenate([
                np.frombuffer(chunk, dtype=np.int16)
                for chunk in self.buffer
            ])
            
            # Transcribe
            try:
                result = self.stt_model.transcribe_bytes(audio_data.tobytes())
                if result:
                    yield result
            except Exception as e:
                # Continue on error, don't break stream
                pass
            
            # Clear buffer
            self.buffer = []
    
    def flush(self) -> Optional[str]:
        """Flush remaining buffer and return final transcription."""
        if not self.buffer:
            return None
        
        import numpy as np
        audio_data = np.concatenate([
            np.frombuffer(chunk, dtype=np.int16)
            for chunk in self.buffer
        ])
        
        self.buffer = []
        return self.stt_model.transcribe_bytes(audio_data.tobytes())

