"""
Tools for the agent to call external models (ONNX, Rust, C++).
"""

from langchain_core.tools import tool
from typing import Optional, List, Dict, Any, Union
import os
import base64
from PIL import Image
import cv2
import numpy as np

from .model_integration import (
    ModelRegistry,
    ONNXModelBackend,
    RustModelBackend,
    CppModelBackend,
    default_registry
)


@tool
def call_onnx_model(
    model_path: str,
    input_data_path: str,
    input_type: str = "image",
    providers: Optional[List[str]] = None
) -> str:
    """
    Call an ONNX model for inference.
    Use this tool when you need to run inference on an ONNX model.
    
    Args:
        model_path: Path to the ONNX model file (.onnx)
        input_data_path: Path to the input data file (image, text file, etc.)
        input_type: Type of input data ("image", "text", "tensor")
        providers: Optional list of execution providers (e.g., ["CUDAExecutionProvider", "CPUExecutionProvider"])
    
    Returns:
        JSON string with model outputs
    """
    try:
        import json
        
        # Load input data
        if input_type == "image":
            image = Image.open(input_data_path)
            data = np.array(image)
        elif input_type == "text":
            with open(input_data_path, 'r') as f:
                data = f.read()
        else:
            data = np.load(input_data_path)
        
        # Create backend
        config = {}
        if providers:
            config["providers"] = providers
        
        backend = ONNXModelBackend(model_path, config)
        
        # Run inference
        outputs = backend.infer(data)
        
        # Convert outputs to JSON-serializable format
        result = {}
        for name, output in outputs.items():
            if isinstance(output, np.ndarray):
                result[name] = {
                    "shape": list(output.shape),
                    "data": output.flatten().tolist()[:100],  # Limit size
                    "dtype": str(output.dtype)
                }
            else:
                result[name] = str(output)
        
        return json.dumps(result, indent=2)
    
    except Exception as e:
        return f"Error calling ONNX model: {str(e)}"


@tool
def call_rust_model(
    model_dir: str,
    config_path: str,
    input_data_path: str,
    input_type: str = "image",
    rust_binary: Optional[str] = None
) -> str:
    """
    Call a Rust model for inference.
    Use this tool when you need to run inference on a Rust model (using the model-runtime framework).
    
    Args:
        model_dir: Directory containing the Rust model files
        config_path: Path to the model configuration file (YAML/JSON)
        input_data_path: Path to the input data file
        input_type: Type of input data ("image", "text", "tensor")
        rust_binary: Optional path to Rust inference binary (if not using FFI)
    
    Returns:
        JSON string with model outputs
    """
    try:
        import json
        
        # Load input data
        if input_type == "image":
            image = Image.open(input_data_path)
            data = np.array(image)
        elif input_type == "text":
            with open(input_data_path, 'r') as f:
                data = f.read()
        else:
            data = np.load(input_data_path)
        
        # Create backend
        config = {
            "config_path": config_path,
            "rust_binary": rust_binary
        }
        
        backend = RustModelBackend(model_dir, config)
        
        # Run inference
        outputs = backend.infer(data)
        
        return json.dumps(outputs, indent=2)
    
    except Exception as e:
        return f"Error calling Rust model: {str(e)}"


@tool
def call_cpp_model(
    model_path: str,
    input_data_path: str,
    input_type: str = "image",
    cpp_binary: Optional[str] = None,
    shared_lib: Optional[str] = None
) -> str:
    """
    Call a C++ model for inference.
    Use this tool when you need to run inference on a C++ model.
    
    Args:
        model_path: Path to the C++ model file or directory
        input_data_path: Path to the input data file
        input_type: Type of input data ("image", "text", "tensor")
        cpp_binary: Optional path to C++ inference binary
        shared_lib: Optional path to C++ shared library (.so/.dll)
    
    Returns:
        JSON string with model outputs
    """
    try:
        import json
        
        # Load input data
        if input_type == "image":
            image = Image.open(input_data_path)
            data = np.array(image)
        elif input_type == "text":
            with open(input_data_path, 'r') as f:
                data = f.read()
        else:
            data = np.load(input_data_path)
        
        # Create backend
        config = {
            "cpp_binary": cpp_binary,
            "shared_lib": shared_lib
        }
        
        backend = CppModelBackend(model_path, config)
        
        # Run inference
        outputs = backend.infer(data)
        
        return json.dumps(outputs, indent=2)
    
    except Exception as e:
        return f"Error calling C++ model: {str(e)}"


@tool
def register_model(
    model_name: str,
    model_type: str,
    model_path: str,
    config: Optional[str] = None
) -> str:
    """
    Register a model for later use.
    Use this tool to register a model so it can be called by name.
    
    Args:
        model_name: Name to register the model under
        model_type: Type of model ("onnx", "rust", "cpp")
        model_path: Path to the model file or directory
        config: Optional JSON string with model configuration
    
    Returns:
        Confirmation message
    """
    try:
        import json
        
        # Parse config if provided
        model_config = {}
        if config:
            model_config = json.loads(config)
        
        # Create appropriate backend
        if model_type == "onnx":
            backend = ONNXModelBackend(model_path, model_config)
        elif model_type == "rust":
            backend = RustModelBackend(model_path, model_config)
        elif model_type == "cpp":
            backend = CppModelBackend(model_path, model_config)
        else:
            return f"Error: Unknown model type '{model_type}'. Must be 'onnx', 'rust', or 'cpp'."
        
        # Register model
        default_registry.register(model_name, backend)
        
        return f"Model '{model_name}' ({model_type}) registered successfully at {model_path}"
    
    except Exception as e:
        return f"Error registering model: {str(e)}"


@tool
def call_registered_model(
    model_name: str,
    input_data_path: str,
    input_type: str = "image"
) -> str:
    """
    Call a previously registered model by name.
    Use this tool to run inference on a model that has been registered.
    
    Args:
        model_name: Name of the registered model
        input_data_path: Path to the input data file
        input_type: Type of input data ("image", "text", "tensor", "video")
    
    Returns:
        JSON string with model outputs
    """
    try:
        import json
        
        # Get model from registry
        backend = default_registry.get(model_name)
        if not backend:
            available = ", ".join(default_registry.list_models())
            return f"Error: Model '{model_name}' not found. Available models: {available}"
        
        # Load input data
        if input_type == "image":
            image = Image.open(input_data_path)
            data = np.array(image)
        elif input_type == "text":
            with open(input_data_path, 'r') as f:
                data = f.read()
        elif input_type == "video":
            # Load video frame
            cap = cv2.VideoCapture(input_data_path)
            ret, frame = cap.read()
            cap.release()
            if not ret:
                return "Error: Could not read video file"
            data = frame
        else:
            data = np.load(input_data_path)
        
        # Run inference
        outputs = backend.infer(data)
        
        return json.dumps(outputs, indent=2)
    
    except Exception as e:
        return f"Error calling registered model: {str(e)}"


@tool
def list_registered_models() -> str:
    """
    List all registered models.
    Use this tool to see what models are available for inference.
    
    Returns:
        List of registered model names
    """
    try:
        models = default_registry.list_models()
        if not models:
            return "No models registered."
        
        result = "Registered models:\n"
        for model_name in models:
            backend = default_registry.get(model_name)
            backend_type = type(backend).__name__.replace("ModelBackend", "").lower()
            result += f"  - {model_name} ({backend_type})\n"
        
        return result
    
    except Exception as e:
        return f"Error listing models: {str(e)}"


class ModelToolManager:
    """Manager for model inference tools."""
    
    def __init__(self, registry: Optional[ModelRegistry] = None):
        """
        Initialize model tool manager.
        
        Args:
            registry: Optional model registry (defaults to global registry)
        """
        self.registry = registry or default_registry
        self.tools = [
            call_onnx_model,
            call_rust_model,
            call_cpp_model,
            register_model,
            call_registered_model,
            list_registered_models
        ]
    
    def get_tools(self):
        """Get all model inference tools."""
        return self.tools
    
    def register_model_from_config(
        self,
        model_name: str,
        model_type: str,
        model_path: str,
        config_path: Optional[str] = None
    ):
        """
        Register a model from a configuration file.
        
        Args:
            model_name: Name to register the model under
            model_type: Type of model ("onnx", "rust", "cpp")
            model_path: Path to the model file or directory
            config_path: Optional path to configuration file
        """
        config = {}
        if config_path and os.path.exists(config_path):
            import json
            with open(config_path, 'r') as f:
                if config_path.endswith('.json'):
                    config = json.load(f)
                else:
                    import yaml
                    config = yaml.safe_load(f)
        
        if model_type == "onnx":
            backend = ONNXModelBackend(model_path, config)
        elif model_type == "rust":
            backend = RustModelBackend(model_path, config)
        elif model_type == "cpp":
            backend = CppModelBackend(model_path, config)
        else:
            raise ValueError(f"Unknown model type: {model_type}")
        
        self.registry.register(model_name, backend)


# Default model tool manager
default_model_tool_manager = ModelToolManager()

