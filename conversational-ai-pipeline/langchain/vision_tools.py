"""
Vision tools for processing images and videos in the conversational agent.
Handles screen recordings, camera videos, and static images.
"""

from langchain_core.tools import tool
from typing import Optional, List, Union
import base64
import io
from PIL import Image
import cv2
import numpy as np
from pathlib import Path
import os


@tool
def process_image(image_path: str, description: Optional[str] = None) -> str:
    """
    Process an image file and return its description.
    Use this tool when you need to understand what's in an image.
    
    Args:
        image_path: Path to the image file
        description: Optional description of what to look for in the image
    
    Returns:
        Description of the image content
    """
    try:
        if not os.path.exists(image_path):
            return f"Error: Image file not found at {image_path}"
        
        # Load and validate image
        img = Image.open(image_path)
        img.verify()  # Verify it's a valid image
        
        # Get basic image info
        width, height = img.size
        format_type = img.format
        mode = img.mode
        
        info = f"Image loaded successfully. Dimensions: {width}x{height}, Format: {format_type}, Mode: {mode}"
        
        if description:
            info += f"\nLooking for: {description}"
        
        # Note: Actual vision model processing would happen in the agent's vision model
        # This tool prepares the image for processing
        return f"{info}\n[Image ready for vision model processing]"
    
    except Exception as e:
        return f"Error processing image: {str(e)}"


@tool
def process_video_frame(video_path: str, frame_number: int, description: Optional[str] = None) -> str:
    """
    Extract and process a specific frame from a video file.
    Use this tool when you need to analyze a specific moment in a video.
    
    Args:
        video_path: Path to the video file
        frame_number: Frame number to extract (0-indexed)
        description: Optional description of what to look for
    
    Returns:
        Information about the extracted frame
    """
    try:
        if not os.path.exists(video_path):
            return f"Error: Video file not found at {video_path}"
        
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return f"Error: Could not open video file {video_path}"
        
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS)
        
        if frame_number >= total_frames:
            cap.release()
            return f"Error: Frame {frame_number} out of range. Video has {total_frames} frames."
        
        # Seek to frame
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
        ret, frame = cap.read()
        cap.release()
        
        if not ret:
            return f"Error: Could not read frame {frame_number}"
        
        # Get frame info
        height, width = frame.shape[:2]
        info = f"Frame {frame_number} extracted. Dimensions: {width}x{height}, Total frames: {total_frames}, FPS: {fps:.2f}"
        
        if description:
            info += f"\nLooking for: {description}"
        
        # Save frame temporarily for vision model processing
        frame_path = f"/tmp/frame_{frame_number}.jpg"
        cv2.imwrite(frame_path, frame)
        
        return f"{info}\n[Frame saved to {frame_path} for vision model processing]"
    
    except Exception as e:
        return f"Error processing video frame: {str(e)}"


@tool
def extract_video_summary(video_path: str, num_frames: int = 5, description: Optional[str] = None) -> str:
    """
    Extract a summary of key frames from a video.
    Use this tool to get an overview of video content by sampling frames.
    
    Args:
        video_path: Path to the video file
        num_frames: Number of frames to sample (default: 5)
        description: Optional description of what to look for
    
    Returns:
        Summary of extracted frames
    """
    try:
        if not os.path.exists(video_path):
            return f"Error: Video file not found at {video_path}"
        
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return f"Error: Could not open video file {video_path}"
        
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS)
        duration = total_frames / fps if fps > 0 else 0
        
        if total_frames == 0:
            cap.release()
            return "Error: Video has no frames"
        
        # Sample frames evenly
        frame_indices = [int(i * total_frames / (num_frames + 1)) for i in range(1, num_frames + 1)]
        extracted_frames = []
        
        for idx in frame_indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ret, frame = cap.read()
            if ret:
                frame_path = f"/tmp/video_summary_frame_{idx}.jpg"
                cv2.imwrite(frame_path, frame)
                extracted_frames.append((idx, frame_path))
        
        cap.release()
        
        summary = f"Video summary: {total_frames} frames, {duration:.2f}s duration, {fps:.2f} FPS\n"
        summary += f"Extracted {len(extracted_frames)} key frames: {[f[0] for f in extracted_frames]}"
        
        if description:
            summary += f"\nLooking for: {description}"
        
        return summary
    
    except Exception as e:
        return f"Error extracting video summary: {str(e)}"


@tool
def analyze_screen_recording(video_path: str, description: Optional[str] = None) -> str:
    """
    Analyze a screen recording video to understand what's happening on screen.
    Use this tool when processing screen recordings from the user's computer.
    
    Args:
        video_path: Path to the screen recording video file
        description: Optional description of what to analyze (e.g., "what application is open", "what text is visible")
    
    Returns:
        Analysis of the screen recording
    """
    try:
        if not os.path.exists(video_path):
            return f"Error: Screen recording not found at {video_path}"
        
        # Use video summary tool to get key frames
        summary = extract_video_summary(video_path, num_frames=10, description=description)
        
        return f"Screen recording analysis:\n{summary}\n[Ready for vision model to process frames]"
    
    except Exception as e:
        return f"Error analyzing screen recording: {str(e)}"


@tool
def analyze_camera_video(video_path: str, description: Optional[str] = None) -> str:
    """
    Analyze a camera video to understand the user's visual context.
    Use this tool when processing camera recordings of the user.
    
    Args:
        video_path: Path to the camera video file
        description: Optional description of what to analyze (e.g., "user's expression", "gestures", "background")
    
    Returns:
        Analysis of the camera video
    """
    try:
        if not os.path.exists(video_path):
            return f"Error: Camera video not found at {video_path}"
        
        # Use video summary tool to get key frames
        summary = extract_video_summary(video_path, num_frames=10, description=description)
        
        return f"Camera video analysis:\n{summary}\n[Ready for vision model to process frames]"
    
    except Exception as e:
        return f"Error analyzing camera video: {str(e)}"


@tool
def compare_frames(frame1_path: str, frame2_path: str) -> str:
    """
    Compare two image frames to identify changes.
    Use this tool to detect what changed between two frames (e.g., screen changes).
    
    Args:
        frame1_path: Path to the first frame
        frame2_path: Path to the second frame
    
    Returns:
        Description of differences between frames
    """
    try:
        if not os.path.exists(frame1_path):
            return f"Error: Frame 1 not found at {frame1_path}"
        if not os.path.exists(frame2_path):
            return f"Error: Frame 2 not found at {frame2_path}"
        
        # Load images
        img1 = cv2.imread(frame1_path)
        img2 = cv2.imread(frame2_path)
        
        if img1 is None or img2 is None:
            return "Error: Could not load one or both frames"
        
        # Resize if dimensions don't match
        if img1.shape != img2.shape:
            h, w = min(img1.shape[0], img2.shape[0]), min(img1.shape[1], img2.shape[1])
            img1 = cv2.resize(img1, (w, h))
            img2 = cv2.resize(img2, (w, h))
        
        # Calculate difference
        diff = cv2.absdiff(img1, img2)
        diff_gray = cv2.cvtColor(diff, cv2.COLOR_BGR2GRAY)
        change_percentage = (np.sum(diff_gray > 30) / diff_gray.size) * 100
        
        info = f"Frame comparison:\n"
        info += f"Frame 1: {img1.shape[1]}x{img1.shape[0]}\n"
        info += f"Frame 2: {img2.shape[1]}x{img2.shape[0]}\n"
        info += f"Change detected: {change_percentage:.2f}% of pixels differ significantly"
        
        if change_percentage > 5:
            info += "\n[Significant changes detected - ready for vision model analysis]"
        else:
            info += "\n[Minimal changes - frames are similar]"
        
        return info
    
    except Exception as e:
        return f"Error comparing frames: {str(e)}"


class VisionToolManager:
    """
    Manages vision tools for the agent.
    """
    
    def __init__(self):
        """Initialize vision tool manager."""
        self.vision_tools = [
            process_image,
            process_video_frame,
            extract_video_summary,
            analyze_screen_recording,
            analyze_camera_video,
            compare_frames
        ]
    
    def get_tools(self) -> List:
        """Get all vision tools."""
        return self.vision_tools


# Default vision tool manager instance
default_vision_tool_manager = VisionToolManager()

