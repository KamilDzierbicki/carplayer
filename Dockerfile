FROM golang:1.25-alpine AS builder

WORKDIR /app
COPY go.mod ./
COPY main.go ./

# Build the Go binary
RUN go build -o server_go.bin main.go

# Production stage
FROM alpine:latest

WORKDIR /app

# Copy the binary from builder
COPY --from=builder /app/server_go.bin ./server_go.bin

# Copy static files to public directory (expected by Go server by default)
COPY index.html style.css ./public/
COPY js ./public/js
COPY icons ./public/icons

ENV PORT=8080

EXPOSE 8080

CMD ["./server_go.bin", "-static", "public"]
