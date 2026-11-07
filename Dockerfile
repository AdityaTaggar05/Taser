FROM node:24-trixie-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip gnupg bash && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ARG CRE_VERSION=v1.39.0
# Official installer verifies the downloaded CLI. Keep authentication out of images.
RUN curl --fail --show-error --location --connect-timeout 15 --max-time 60 --retry 3 https://app.chain.link/cre/install.sh -o /tmp/install-cre.sh \
    && node -e 'const fs=require("fs"),p="/tmp/install-cre.sh",s=fs.readFileSync(p,"utf8"),a=s.indexOf("API_RESPONSE=$("),b=s.indexOf("# Allow an explicit tag override",a);if(a<0||b<0)throw Error("Installer changed");fs.writeFileSync(p,s.slice(0,a)+"LATEST_TAG=\"\$1\"\n"+s.slice(b))' \
    && bash /tmp/install-cre.sh "$CRE_VERSION" \
    && install -m 755 /root/.cre/bin/cre /usr/local/bin/cre \
    && rm -rf /root/.cre /tmp/install-cre.sh
ENV PATH="/app/node_modules/.bin:${PATH}"
RUN cd cre-project/level-verification && bun install --frozen-lockfile && bunx cre-setup

FROM node:24-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates bash && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /usr/local/bin/cre /usr/local/bin/cre
COPY --from=build --chown=node:node /app /app
COPY --from=build --chown=node:node /root/.cache/javy /home/node/.cache/javy
ENV NODE_ENV=production PORT=5173 PATH="/app/node_modules/.bin:${PATH}"
RUN mkdir -p /app/.data /home/node/.cre && chown -R node:node /app/.data /home/node/.cre
USER node
EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
