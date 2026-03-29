FROM nginx:1.27-alpine

WORKDIR /usr/share/nginx/html

# Clear the default Nginx site and copy the static demo files.
RUN rm -rf ./*

COPY index.html ./
COPY assets ./assets

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
