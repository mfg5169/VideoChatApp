# Usage Guide

## Basic Usage

### 1. Prepare Your Model

First, convert your model weights to SafeTensors format:

```python
from safetensors.torch import save_file
import torch

# Load your model
model = torch.load("your_model.pt")
state_dict = model.state_dict()

# Save as SafeTensors
save_file(state_dict, "model.safetensors")
```

### 2. Create Configuration File

Create a YAML configuration file describing your model:

```yaml
metadata:
  name: "my-model"
  version: "1.0.0"
  task: "classification"

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

### 3. Use in Rust Code

```rust
use model_runtime::create_runtime;
use candle_core::Tensor;

// Load model
let runtime = create_runtime("./models", "config.yaml", None)?;

// Prepare input
let input = Tensor::zeros(&[1, 768], runtime.device())?;

// Run inference
let output = runtime.infer(&input)?;
```

## Advanced Usage

### Custom Architectures

You can register custom architecture builders:

```rust
use model_runtime::{ArchitectureBuilder, ArchitectureRegistry, ModelConfig, Model};
use candle_core::Device;
use candle_nn::VarBuilder;

struct MyCustomBuilder;

impl ArchitectureBuilder for MyCustomBuilder {
    fn build(
        &self,
        config: &ModelConfig,
        vb: VarBuilder<'_>,
        device: &Device,
    ) -> Result<Box<dyn Model>> {
        // Build your custom architecture
        // ...
    }
}

// Register it
let mut registry = ArchitectureRegistry::new();
registry.register(ArchitectureType::Custom("my_arch".to_string()), 
                  Box::new(MyCustomBuilder));
```

### GPU Acceleration

```rust
use candle_core::Device;

// Check if CUDA is available
if Device::cuda_if_available(0).is_ok() {
    let device = Device::new_cuda(0)?;
    let runtime = create_runtime("./models", "config.yaml", Some(device))?;
} else {
    println!("CUDA not available, using CPU");
    let runtime = create_runtime("./models", "config.yaml", None)?;
}
```

### Batch Inference

```rust
let inputs = vec![
    Tensor::zeros(&[1, 768], runtime.device())?,
    Tensor::zeros(&[1, 768], runtime.device())?,
];

let outputs = runtime.infer_batch(&inputs)?;
```

### Async Inference

```rust
use model_runtime::AsyncModelRuntime;

let runtime = ModelRuntime::from_config("./models", "config.yaml", None)?;
let async_runtime = AsyncModelRuntime::new(runtime);

let output = async_runtime.infer_async(&input).await?;
```

## Model Directory Structure

```
models/
├── config.yaml          # Model configuration
├── model.safetensors    # Model weights
├── vocab.json          # Tokenizer vocabulary (if applicable)
└── merges.txt          # Tokenizer merges (if applicable)
```

## Performance Tips

1. **Use SafeTensors**: Convert PyTorch models to SafeTensors for faster loading
2. **GPU**: Use CUDA when available for significant speedup
3. **Batch Processing**: Process multiple inputs together when possible
4. **Preprocessing**: Do preprocessing outside the model when possible

## Troubleshooting

### Model Not Loading

- Check that weight file paths in config match actual files
- Verify weight format is supported (SafeTensors recommended)
- Ensure configuration file is valid YAML/JSON

### Out of Memory

- Reduce batch size
- Use CPU instead of GPU if GPU memory is limited
- Check model size matches available memory

### Slow Inference

- Enable GPU if available
- Increase batch size for better GPU utilization
- Profile to identify bottlenecks

