"""
LangChain-based conversational agent package.
Provides agentic conversational AI with search, memory, and tool capabilities.
"""

from .agent import ConversationalAgent, create_agent, AgentState
from .memory import (
    MemoryManager,
    ConversationMemory,
    LongTermMemory
)
from .tools import (
    ToolManager,
    web_search,
    wikipedia_search,
    get_current_time,
    calculate,
    default_tool_manager
)
from .vision_tools import (
    VisionToolManager,
    process_image,
    process_video_frame,
    extract_video_summary,
    analyze_screen_recording,
    analyze_camera_video,
    compare_frames,
    default_vision_tool_manager
)
from .model_integration import (
    ModelBackend,
    ONNXModelBackend,
    RustModelBackend,
    CppModelBackend,
    ModelRegistry,
    default_registry
)
from .model_tools import (
    ModelToolManager,
    call_onnx_model,
    call_rust_model,
    call_cpp_model,
    register_model,
    call_registered_model,
    list_registered_models,
    default_model_tool_manager
)

__all__ = [
    # Agent
    "ConversationalAgent",
    "create_agent",
    "AgentState",
    
    # Memory
    "MemoryManager",
    "ConversationMemory",
    "LongTermMemory",
    
    # Tools
    "ToolManager",
    "web_search",
    "wikipedia_search",
    "get_current_time",
    "calculate",
    "default_tool_manager",
    
    # Vision Tools
    "VisionToolManager",
    "process_image",
    "process_video_frame",
    "extract_video_summary",
    "analyze_screen_recording",
    "analyze_camera_video",
    "compare_frames",
    "default_vision_tool_manager",
    
    # Model Integration
    "ModelBackend",
    "ONNXModelBackend",
    "RustModelBackend",
    "CppModelBackend",
    "ModelRegistry",
    "default_registry",
    
    # Model Tools
    "ModelToolManager",
    "call_onnx_model",
    "call_rust_model",
    "call_cpp_model",
    "register_model",
    "call_registered_model",
    "list_registered_models",
    "default_model_tool_manager",
]

__version__ = "0.1.0"

