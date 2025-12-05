# Model Integration Guide

The agentic workflow now supports calling external models in multiple formats: ONNX, Rust, and C++.

## Overview

The agent can:
- Register external models for later use
- Call models directly with data (images, text, videos, tensors)
- Automatically handle data preprocessing and postprocessing
- Support multiple model backends simultaneously

## Supported Model Types

### ONNX Models
- Format: `.onnx` files
- Runtime: `onnxruntime`
- Supports: CPU and GPU execution providers
- Best for: Models exported from PyTorch, TensorFlow, etc.

### Rust Models
- Format: Model directory with `config.yaml` and weight files
- Runtime: Rust model-runtime framework (via subprocess or FFI)
- Supports: Fast native inference
- Best for: High-performance inference needs

### C++ Models
- Format: C++ binary or shared library
- Runtime: Subprocess or shared library (via ctypes)
- Supports: Maximum performance
- Best for: Custom optimized models

## Usage

### Registering Models

#### Method 1: Using the Agent API

```python
from langchain import create_agent

agent = create_agent()

# Register an ONNX model
agent.register_external_model(
    model_name="classifier",
    model_type="onnx",
    model_path="./models/classifier.onnx"
)

# Register a Rust model
agent.register_external_model(
    model_name="transformer",
    model_type="rust",
    model_path="./rust/models/transformer",
    config_path="./rust/models/transformer/config.yaml"
)

# Register a C++ model
agent.register_external_model(
    model_name="vision_model",
    model_type="cpp",
    model_path="./cpp_models/vision",
    config_path=None  # Uses cpp_binary from config
)
```

#### Method 2: Using Tools Directly

The agent can register models using the `register_model` tool:

```python
result = agent.invoke(
    "Register an ONNX model called 'my_model' at ./models/my_model.onnx"
)
```

### Calling Models

#### Direct Model Calls

```python
# Call ONNX model
result = agent.invoke(
    "Run inference on image.png using the classifier ONNX model",
    image_paths=["./image.png"]
)

# Call Rust model
result = agent.invoke(
    "Process this text with the transformer model: 'Hello world'"
)

# Call C++ model
result = agent.invoke(
    "Analyze this video with the vision model",
    video_paths=["./video.mp4"]
)
```

#### Using Registered Models

```python
# List available models
models = agent.list_available_models()
print(f"Available models: {models}")

# Call registered model by name
result = agent.invoke(
    "Use the 'classifier' model to classify image.png",
    image_paths=["./image.png"]
)
```

## Model Configuration

### ONNX Model Configuration

```python
config = {
    "providers": ["CUDAExecutionProvider", "CPUExecutionProvider"]
}

backend = ONNXModelBackend("./model.onnx", config)
```

### Rust Model Configuration

Create a `config.yaml` file:

```yaml
metadata:
  name: "my-model"
  version: "1.0.0"

architecture: transformer

hyperparameters:
  vocab_size: 50257
  hidden_size: 768
  num_attention_heads: 12
  num_layers: 12

weights:
  - path: "model.safetensors"
    format: "safetensors"
```

### C++ Model Configuration

```python
config = {
    "cpp_binary": "./inference_binary",  # Path to C++ executable
    # OR
    "shared_lib": "./libmodel.so"  # Path to shared library
}
```

## Data Types

The framework supports multiple input data types:

### Images
- Formats: PNG, JPEG, etc.
- Preprocessing: Automatic normalization, resizing
- Example: `image_paths=["./image.png"]`

### Text
- Formats: Plain text files or strings
- Preprocessing: Tokenization (if model requires)
- Example: Text file path or direct string

### Videos
- Formats: MP4, AVI, etc.
- Preprocessing: Frame extraction
- Example: `video_paths=["./video.mp4"]`

### Tensors
- Formats: NumPy arrays, NPZ files
- Preprocessing: Shape validation
- Example: NumPy array or `.npz` file path

## Example Workflows

### Image Classification Pipeline

```python
from langchain import create_agent

# Create agent and register classifier
agent = create_agent()
agent.register_external_model(
    model_name="imagenet_classifier",
    model_type="onnx",
    model_path="./models/resnet50.onnx"
)

# Classify an image
result = agent.invoke(
    "What's in this image? Use the imagenet_classifier model.",
    image_paths=["./test_image.jpg"]
)
```

### Multi-Model Pipeline

```python
# Register multiple models
agent.register_external_model("detector", "onnx", "./models/detector.onnx")
agent.register_external_model("classifier", "rust", "./rust/models/classifier")
agent.register_external_model("tracker", "cpp", "./cpp_models/tracker")

# Use multiple models in sequence
result = agent.invoke(
    "First detect objects in this video, then classify them, then track them",
    video_paths=["./video.mp4"]
)
```

### Text Processing with Rust Model

```python
# Register Rust transformer
agent.register_external_model(
    model_name="text_processor",
    model_type="rust",
    model_path="./rust/models/transformer",
    config_path="./rust/models/transformer/config.yaml"
)

# Process text
result = agent.invoke(
    "Process this text with the text_processor model: 'Your text here'"
)
```

## Performance Considerations

1. **ONNX Models**: Good balance of compatibility and performance
2. **Rust Models**: Fastest for CPU inference, lower memory usage
3. **C++ Models**: Maximum performance, requires compilation

## Troubleshooting

### Model Not Found
- Check that model paths are correct
- Verify model files exist
- For Rust/C++ models, ensure binaries are compiled

### Inference Errors
- Check input data format matches model expectations
- Verify model configuration is correct
- Check that required dependencies are installed (onnxruntime, etc.)

### Performance Issues
- Use GPU providers for ONNX models when available
- Consider Rust models for CPU-bound workloads
- Batch multiple inputs when possible

## Advanced Usage

### Custom Model Backends

You can create custom model backends by extending `ModelBackend`:

```python
from langchain.model_integration import ModelBackend

class CustomModelBackend(ModelBackend):
    def infer(self, data, **kwargs):
        # Your custom inference logic
        return result
    
    def supports_data_type(self, data_type):
        return data_type in ["image", "text"]

# Register custom backend
registry = ModelRegistry()
registry.register("custom_model", CustomModelBackend("./model", {}))
```

### Batch Processing

```python
# Process multiple inputs
results = []
for image_path in image_paths:
    result = agent.invoke(
        f"Classify {image_path}",
        image_paths=[image_path]
    )
    results.append(result)
```

## Integration with Agent Tools

The model integration tools are automatically available to the agent:

- `call_onnx_model`: Call ONNX models directly
- `call_rust_model`: Call Rust models directly
- `call_cpp_model`: Call C++ models directly
- `register_model`: Register models for later use
- `call_registered_model`: Call registered models by name
- `list_registered_models`: List all registered models

The agent will automatically use these tools when appropriate based on the user's request.

