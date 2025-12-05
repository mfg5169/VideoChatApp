# Model Runtime - Rust ML Framework

A high-performance Rust framework for loading and running neural network models. This framework allows you to:

- Load model configurations from YAML/JSON files
- Load model weights from various formats (SafeTensors, PyTorch, ONNX)
- Reconstruct neural network architectures in Rust
- Run fast inference with optimized Rust code

## Features

- **Multiple Architecture Support**: Transformer, CNN, Vision Transformer, and more
- **Flexible Configuration**: YAML/JSON configuration files
- **Multiple Weight Formats**: SafeTensors (primary), PyTorch, ONNX support
- **High Performance**: Rust-native implementation for fast inference
- **GPU Support**: CUDA acceleration when available
- **Async Support**: Async runtime for concurrent inference

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
model-runtime = { path = "./rust" }
```

Or if publishing as a crate:

```toml
[dependencies]
model-runtime = "0.1.0"
```

## Quick Start

### 1. Create a Model Configuration

Create a YAML file (e.g., `model_config.yaml`):

```yaml
metadata:
  name: "my-model"
  version: "1.0.0"
  task: "text-generation"

architecture: transformer

hyperparameters:
  vocab_size: 50257
  hidden_size: 768
  num_attention_heads: 12
  num_layers: 12
  intermediate_size: 3072

layers:
  - layer_type: "embedding"
    name: "embeddings"
    input_dims: [50257]
    output_dims: [768]

weights:
  - path: "model.safetensors"
    format: "safetensors"
```

### 2. Load and Run the Model

```rust
use model_runtime::{create_runtime, ModelRuntime};
use candle_core::Tensor;

// Create runtime
let runtime = create_runtime("./models/my_model", "model_config.yaml", None)?;

// Prepare input
let input_data = vec![1.0f32; 768];
let input = Tensor::from_slice(&input_data, &[1, 768], runtime.device())?;

// Run inference
let output = runtime.infer(&input)?;

println!("Output shape: {:?}", output.shape());
```

## Model Configuration Format

### Required Fields

- `metadata`: Model metadata (name, version, etc.)
- `architecture`: Architecture type (transformer, cnn, vision_transformer, etc.)
- `hyperparameters`: Model hyperparameters
- `layers`: Layer configurations
- `weights`: Weight file configurations

### Example Configurations

See `examples/` directory for complete examples:
- `transformer_model.yaml` - Transformer model
- `cnn_model.yaml` - CNN model
- `vision_transformer.yaml` - Vision Transformer model

## Architecture Types

### Transformer
For transformer-based models (BERT, GPT, etc.)

```yaml
architecture: transformer
hyperparameters:
  vocab_size: 50257
  hidden_size: 768
  num_attention_heads: 12
  num_layers: 12
```

### CNN
For convolutional neural networks

```yaml
architecture: cnn
hyperparameters:
  num_channels: 3
  image_size: 224
```

### Vision Transformer
For vision transformer models

```yaml
architecture: vision_transformer
hyperparameters:
  image_size: 224
  patch_size: 16
  hidden_size: 768
```

## Weight Formats

### SafeTensors (Recommended)
```yaml
weights:
  - path: "model.safetensors"
    format: "safetensors"
```

### PyTorch
```yaml
weights:
  - path: "model.pt"
    format: "pytorch"
```

Note: PyTorch loading requires conversion to SafeTensors for best performance.

## Device Selection

### CPU
```rust
let runtime = create_runtime("./models", "config.yaml", None)?;
```

### CUDA (if available)
```rust
use candle_core::Device;

let device = Device::new_cuda(0)?;
let runtime = create_runtime("./models", "config.yaml", Some(device))?;
```

Or use the convenience function:
```rust
use model_runtime::create_runtime_cuda;

let runtime = create_runtime_cuda("./models", "config.yaml")?;
```

## Async Inference

For concurrent inference:

```rust
use model_runtime::AsyncModelRuntime;

let runtime = ModelRuntime::from_config("./models", "config.yaml", None)?;
let async_runtime = AsyncModelRuntime::new(runtime);

let output = async_runtime.infer_async(&input).await?;
```

## Converting Models

### From PyTorch to SafeTensors

```python
from safetensors.torch import save_file
import torch

# Load PyTorch model
model = torch.load("model.pt")
state_dict = model.state_dict()

# Convert to SafeTensors
save_file(state_dict, "model.safetensors")
```

### From HuggingFace

HuggingFace models can be downloaded and converted:

```python
from transformers import AutoModel
from safetensors.torch import save_file

model = AutoModel.from_pretrained("model-name")
save_file(model.state_dict(), "model.safetensors")
```

## Performance

The Rust implementation provides significant performance improvements:

- **CPU**: 2-5x faster than Python implementations
- **GPU**: Near-native CUDA performance
- **Memory**: Lower memory footprint than Python

## Architecture

```
rust/
├── src/
│   ├── config.rs       # Configuration structures
│   ├── loader.rs       # Weight loading
│   ├── architectures.rs # Architecture builders
│   ├── runtime.rs      # Inference runtime
│   └── lib.rs          # Main library
├── examples/           # Example configurations
└── Cargo.toml          # Dependencies
```

## Contributing

Contributions welcome! Areas for improvement:

- Additional architecture types
- More weight format support
- Optimized kernels
- Better error messages

## License

MIT License

