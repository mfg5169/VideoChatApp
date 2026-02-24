"""
Main agentic conversational agent using LangGraph.
Acts as the brain of the conversational AI pipeline.
"""

from typing import TypedDict, Annotated, Literal, List, Dict, Any, Optional
from langchain.chat_models import init_chat_model
from langchain_core.messages import (
    BaseMessage,
    HumanMessage,
    AIMessage,
    SystemMessage,
    ToolMessage,
    AnyMessage
)
from langchain_core.tools import BaseTool
from langgraph.graph import StateGraph, START, END
from langgraph.prebuilt import ToolNode
import operator

from .memory import MemoryManager
from .tools import ToolManager
from .vision_tools import VisionToolManager
from .model_tools import ModelToolManager
import base64
from pathlib import Path
import os


class AgentState(TypedDict):
    """
    State for the agentic conversational agent.
    """
    messages: Annotated[List[AnyMessage], operator.add]
    llm_calls: int
    tool_calls: int


class ConversationalAgent:
    """
    Main agentic conversational agent with search, memory, and tool capabilities.
    """
    
    def __init__(
        self,
        model_name: str = "claude-sonnet-4-5-20250929",
        temperature: float = 0.7,
        memory_manager: Optional[MemoryManager] = None,
        system_prompt: Optional[str] = None,
        persist_memory: bool = True
    ):
        """
        Initialize the conversational agent.
        
        Args:
            model_name: Name of the LLM model to use
            temperature: Temperature for model generation
            memory_manager: Optional MemoryManager instance
            system_prompt: Optional custom system prompt
            persist_memory: Whether to persist memory to disk
        """
        # Initialize model
        self.model = init_chat_model(model_name, temperature=temperature)
        
        # Initialize memory manager
        self.memory_manager = memory_manager or MemoryManager()
        self.persist_memory = persist_memory
        
        # Initialize tool manager
        self.tool_manager = ToolManager(memory_manager=self.memory_manager)
        
        # Initialize vision tool manager
        self.vision_tool_manager = VisionToolManager()
        
        # Initialize model tool manager
        self.model_tool_manager = ModelToolManager()
        
        # System prompt
        self.system_prompt = system_prompt or self._default_system_prompt()
        
        # Build agent graph
        self.agent = self._build_agent()
    
    def _default_system_prompt(self) -> str:
        """Get default system prompt."""
        return """You are a helpful, intelligent conversational AI assistant with multimodal capabilities. 
You have access to various tools including web search, Wikipedia search, memory retrieval, 
vision tools for processing images and videos, and other utilities. Use these tools when 
appropriate to provide accurate and helpful responses.

Key capabilities:
- Process and understand images and videos (screen recordings, camera videos, static images)
- Search the web for current information
- Search Wikipedia for detailed factual information
- Access your long-term memory to recall past conversations
- Store important facts and user preferences
- Perform calculations and get current time
- Analyze screen recordings to understand what the user is viewing
- Analyze camera videos to understand the user's visual context
- Call external models (ONNX, Rust, C++) for specialized inference tasks
- Register and manage multiple model backends for different tasks

When you receive images or videos, analyze them carefully and provide detailed descriptions.
For screen recordings, focus on understanding what applications, content, or activities are visible.
For camera videos, focus on the user's context, expressions, gestures, and environment.

Always be helpful, accurate, and considerate. When you don't know something, use your search 
tools to find the information. Remember important details about the user and store them for 
future reference."""
    
    def _build_agent(self) -> StateGraph:
        """Build the agentic workflow using LangGraph."""
        
        # Get tools (including vision tools and model tools)
        tools = self.tool_manager.get_tools()
        vision_tools = self.vision_tool_manager.get_tools()
        model_tools = self.model_tool_manager.get_tools()
        tools.extend(vision_tools)
        tools.extend(model_tools)
        tools_by_name = {tool.name: tool for tool in tools}
        
        # Bind tools to model
        model_with_tools = self.model.bind_tools(tools)
        
        # Create tool node
        tool_node = ToolNode(tools)
        
        def should_continue(state: AgentState) -> Literal["tools", "end"]:
            """Decide whether to call tools or end."""
            messages = state["messages"]
            last_message = messages[-1]
            
            # If the last message has tool calls, route to tools
            if hasattr(last_message, 'tool_calls') and last_message.tool_calls:
                return "tools"
            
            # Otherwise, end
            return "end"
        
        def call_model(state: AgentState) -> Dict[str, Any]:
            """Call the LLM with conversation context and memory."""
            messages = state["messages"]
            
            # Get conversation context from memory
            conversation_context = self.memory_manager.get_conversation_context()
            
            # Retrieve relevant long-term memories if there's a user message
            user_messages = [m for m in messages if isinstance(m, HumanMessage)]
            if user_messages:
                last_user_message = user_messages[-1]
                # Extract text from message (handle both string and multimodal content)
                if isinstance(last_user_message.content, str):
                    message_text = last_user_message.content
                elif isinstance(last_user_message.content, list):
                    # Extract text parts from multimodal content
                    text_parts = [
                        item.get("text", "") if isinstance(item, dict) else str(item)
                        for item in last_user_message.content
                    ]
                    message_text = " ".join(text_parts)
                else:
                    message_text = str(last_user_message.content)
                
                relevant_memories = self.memory_manager.retrieve_relevant_memories(
                    message_text, k=3
                )
                
                # Add memory context if available
                if relevant_memories:
                    memory_context = "\n\nRelevant context from past conversations:\n"
                    for mem in relevant_memories:
                        memory_context += f"- {mem['content']}\n"
                    
                    # Insert memory context before the last user message
                    if messages and isinstance(messages[-1], HumanMessage):
                        if isinstance(messages[-1].content, str):
                            messages[-1] = HumanMessage(
                                content=f"{memory_context}\n\nUser: {messages[-1].content}"
                            )
                        elif isinstance(messages[-1].content, list):
                            # Prepend memory context to multimodal content
                            new_content = [{"type": "text", "text": memory_context}]
                            new_content.extend(messages[-1].content)
                            messages[-1] = HumanMessage(content=new_content)
            
            # Build message list with system prompt
            full_messages = [SystemMessage(content=self.system_prompt)]
            
            # Add recent conversation context (last 10 messages to avoid token limits)
            recent_messages = messages[-10:] if len(messages) > 10 else messages
            full_messages.extend(recent_messages)
            
            # Call model
            response = model_with_tools.invoke(full_messages)
            
            return {
                "messages": [response],
                "llm_calls": state.get("llm_calls", 0) + 1
            }
        
        # Build graph
        workflow = StateGraph(AgentState)
        
        # Add nodes
        workflow.add_node("agent", call_model)
        workflow.add_node("tools", tool_node)
        
        # Add edges
        workflow.add_edge(START, "agent")
        workflow.add_conditional_edges(
            "agent",
            should_continue,
            {
                "tools": "tools",
                "end": END
            }
        )
        workflow.add_edge("tools", "agent")
        
        # Compile
        return workflow.compile()
    
    def _prepare_multimodal_message(
        self,
        user_input: str,
        image_paths: Optional[List[str]] = None,
        video_paths: Optional[List[str]] = None
    ) -> HumanMessage:
        """
        Prepare a multimodal message with text, images, and/or videos.
        
        Args:
            user_input: User's text input
            image_paths: Optional list of image file paths
            video_paths: Optional list of video file paths (will extract key frames)
        
        Returns:
            HumanMessage with multimodal content
        """
        content = [{"type": "text", "text": user_input}]
        
        # Add images
        if image_paths:
            for img_path in image_paths:
                if os.path.exists(img_path):
                    # Read image and encode as base64
                    with open(img_path, "rb") as f:
                        image_data = base64.b64encode(f.read()).decode("utf-8")
                    
                    # Determine image format
                    img_ext = Path(img_path).suffix.lower()
                    mime_type = f"image/{img_ext[1:]}" if img_ext else "image/jpeg"
                    
                    content.append({
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime_type};base64,{image_data}"
                        }
                    })
        
        # Add videos (extract key frames)
        if video_paths:
            import cv2
            import tempfile
            
            for video_path in video_paths:
                if os.path.exists(video_path):
                    # Extract a representative frame (middle frame)
                    cap = cv2.VideoCapture(video_path)
                    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                    
                    if total_frames > 0:
                        # Get middle frame
                        middle_frame = total_frames // 2
                        cap.set(cv2.CAP_PROP_POS_FRAMES, middle_frame)
                        ret, frame = cap.read()
                        cap.release()
                        
                        if ret:
                            # Save frame temporarily
                            with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
                                cv2.imwrite(tmp.name, frame)
                                tmp_path = tmp.name
                            
                            # Read and encode frame
                            with open(tmp_path, "rb") as f:
                                image_data = base64.b64encode(f.read()).decode("utf-8")
                            
                            content.append({
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{image_data}"
                                }
                            })
                            
                            # Clean up
                            os.unlink(tmp_path)
        
        return HumanMessage(content=content)
    
    def invoke(
        self,
        user_input: str,
        image_paths: Optional[List[str]] = None,
        video_paths: Optional[List[str]] = None,
        save_to_memory: bool = True
    ) -> Dict[str, Any]:
        """
        Process a user input and return the agent's response.
        Supports multimodal inputs including images and videos.
        
        Args:
            user_input: User's input message
            image_paths: Optional list of image file paths to include
            video_paths: Optional list of video file paths to include (screen recordings, camera videos)
            save_to_memory: Whether to save this interaction to memory
        
        Returns:
            Agent state with messages and metadata
        """
        # Create multimodal message if images/videos provided
        if image_paths or video_paths:
            user_message = self._prepare_multimodal_message(
                user_input, image_paths, video_paths
            )
        else:
            user_message = HumanMessage(content=user_input)
        
        # Create initial state
        initial_state = {
            "messages": [user_message],
            "llm_calls": 0,
            "tool_calls": 0
        }
        
        # Invoke agent
        result = self.agent.invoke(initial_state)
        
        # Extract AI response
        ai_messages = [m for m in result["messages"] if isinstance(m, AIMessage)]
        if ai_messages:
            ai_content = ai_messages[-1].content
            if isinstance(ai_content, str):
                ai_response = ai_content
            else:
                ai_response = str(ai_content)
        else:
            ai_response = "I apologize, but I couldn't generate a response."
        
        # Extract user input text for memory (handle multimodal)
        if isinstance(user_message.content, str):
            user_input_text = user_message.content
        elif isinstance(user_message.content, list):
            text_parts = [
                item.get("text", "") if isinstance(item, dict) else str(item)
                for item in user_message.content
            ]
            user_input_text = " ".join(text_parts)
        else:
            user_input_text = str(user_message.content)
        
        # Save to memory if requested
        if save_to_memory:
            # Determine if this is important enough for long-term storage
            # (e.g., user preferences, personal info, important facts)
            save_to_long_term = self._should_save_to_long_term(user_input_text, ai_response)
            
            self.memory_manager.save_conversation_turn(
                user_input_text,
                ai_response,
                save_to_long_term=save_to_long_term
            )
            
            if self.persist_memory:
                self.memory_manager.persist()
        
        return result
    
    def _should_save_to_long_term(self, user_input: str, ai_response: str) -> bool:
        """
        Determine if a conversation turn should be saved to long-term memory.
        This is a simple heuristic - can be improved with ML classification.
        
        Args:
            user_input: User's input
            ai_response: AI's response
        
        Returns:
            True if should save to long-term memory
        """
        # Keywords that indicate important information
        important_keywords = [
            "remember", "prefer", "like", "dislike", "favorite",
            "my name is", "i am", "i'm", "i live", "i work",
            "important", "always", "never", "don't forget"
        ]
        
        user_lower = user_input.lower()
        return any(keyword in user_lower for keyword in important_keywords)
    
    def stream(
        self,
        user_input: str,
        image_paths: Optional[List[str]] = None,
        video_paths: Optional[List[str]] = None
    ):
        """
        Stream the agent's response (for real-time interactions).
        Supports multimodal inputs including images and videos.
        
        Args:
            user_input: User's input message
            image_paths: Optional list of image file paths to include
            video_paths: Optional list of video file paths to include
        
        Yields:
            Agent state updates
        """
        # Create multimodal message if images/videos provided
        if image_paths or video_paths:
            user_message = self._prepare_multimodal_message(
                user_input, image_paths, video_paths
            )
        else:
            user_message = HumanMessage(content=user_input)
        
        initial_state = {
            "messages": [user_message],
            "llm_calls": 0,
            "tool_calls": 0
        }
        
        for chunk in self.agent.stream(initial_state):
            #return the chunk to the caller
            #the caller can then process the chunk as needed
            #this is a generator function, so it will return the chunk to the caller
            #pick up where we left off in the generator function
            yield chunk 
    
    def get_conversation_history(self) -> List[BaseMessage]:
        """Get the current conversation history."""
        return self.memory_manager.get_conversation_context()
    
    def clear_memory(self) -> None:
        """Clear all memory (conversation and long-term)."""
        self.memory_manager.clear_all()
    
    def update_system_prompt(self, new_prompt: str) -> None:
        """Update the system prompt and rebuild the agent."""
        self.system_prompt = new_prompt
        self.agent = self._build_agent()
    
    def register_external_model(
        self,
        model_name: str,
        model_type: str,
        model_path: str,
        config_path: Optional[str] = None
    ) -> None:
        """
        Register an external model for the agent to use.
        
        Args:
            model_name: Name to register the model under
            model_type: Type of model ("onnx", "rust", "cpp")
            model_path: Path to the model file or directory
            config_path: Optional path to configuration file
        """
        self.model_tool_manager.register_model_from_config(
            model_name, model_type, model_path, config_path
        )
        # Rebuild agent to include the new model
        self.agent = self._build_agent()
    
    def list_available_models(self) -> List[str]:
        """List all available external models."""
        return self.model_tool_manager.registry.list_models()


def create_agent(
    model_name: str = "claude-sonnet-4-5-20250929",
    temperature: float = 0.7,
    memory_persist_directory: Optional[str] = None,
    system_prompt: Optional[str] = None
) -> ConversationalAgent:
    """
    Factory function to create a conversational agent with default settings.
    
    Args:
        model_name: Name of the LLM model
        temperature: Temperature for generation
        memory_persist_directory: Directory to persist memory
        system_prompt: Optional custom system prompt
    
    Returns:
        Configured ConversationalAgent instance
    """
    memory_manager = MemoryManager(
        conversation_memory_type="buffer",
        vector_store_type="faiss",
        persist_directory=memory_persist_directory
    )
    
    return ConversationalAgent(
        model_name=model_name,
        temperature=temperature,
        memory_manager=memory_manager,
        system_prompt=system_prompt
    )

