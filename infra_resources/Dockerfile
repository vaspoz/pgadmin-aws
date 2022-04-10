FROM dpage/pgadmin4

RUN mkdir -m 700 /var/lib/pgadmin/storage && \
    mkdir -m 700 /var/lib/pgadmin/storage/pgadmin4_pgadmin.org

COPY servers.json /pgadmin4/servers.json
COPY pgpassfile /var/lib/pgadmin/storage/pgadmin4_pgadmin.org/pgpassfile