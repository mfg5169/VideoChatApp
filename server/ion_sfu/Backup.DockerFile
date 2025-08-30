# ---------- Build your Go app ----------
    FROM golang:1.23-alpine AS build
    WORKDIR /app
    
    # Cache deps
    COPY go.mod go.sum ./
    RUN go mod download && go mod verify
    
    # Copy source and build
    COPY . .
    RUN go build -v -o /app/main .
    
    # ---------- Runtime with Kafka CLI ----------
    FROM alpine:3.20
    
    # 1) Runtime deps for your app + Kafka CLI
    # - bash      : Kafka scripts are bash
    # - openjdk   : Kafka CLI needs a JRE
    # - curl/tar  : to fetch Kafka
    # - ca-certs  : TLS trust
    # - jq        : handy for quick JSON checks
    RUN apk add --no-cache bash curl tar openjdk17-jre-headless ca-certificates jq
    
    # 2) Fetch Kafka and expose scripts on PATH
    #    Pin versions as desired via build args
    ARG KAFKA_VERSION=3.7.1
    ARG SCALA_VERSION=2.13
    RUN curl -fsSLo /tmp/kafka.tgz \
          https://downloads.apache.org/kafka/${KAFKA_VERSION}/kafka_${SCALA_VERSION}-${KAFKA_VERSION}.tgz \
     && mkdir -p /opt \
     && tar -xzf /tmp/kafka.tgz -C /opt \
     && ln -s /opt/kafka_${SCALA_VERSION}-${KAFKA_VERSION} /opt/kafka \
     && ln -s /opt/kafka/bin/* /usr/local/bin/ \
     && rm -f /tmp/kafka.tgz
    
    # (Optional) super-light tester; uncomment if you want it
    # RUN apk add --no-cache kcat
    
    # 3) Copy your app
    WORKDIR /app
    COPY --from=build /app/main /app/main
    
    # 4) (Optional) add a client.properties for SASL/SSL and mount certs at runtime
    # COPY client.properties /opt/kafka/client.properties
    
    EXPOSE 8080
    CMD ["/app/main"]
    